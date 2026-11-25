/**
 * Denge simülasyonu (saf, deterministik): sektör kârları, ilk iş, yatırım geri dönüşü, kalite primi, taşımacılık tarifesi,
 * spot/sözleşme ve tedarikçi seçimi karşılaştırmaları, sistem bütçesi ve arbitraj denetimi.
 * Çıktı: docs/economy/denge.md. Başarısız denetimde çıkış kodu 1. Model: sim/model.ts.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILDING_TYPES, CITIES, PRODUCTS, QUALITY_PRICE_BP, RECIPES, SYSTEM_PROFILES, VEHICLE_MODELS, SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY, roadDistanceKm,
} from "@capitalforge/shared";
import {
  chooseSupplier, contractVsSpot, deadlinePremiumBp, estimateOwnTrip, roundTripValue, refPrice, systemAsk, systemBid, systemCarrierQuote, systemContractPrice,
} from "../src/index";
import {
  AGENTS, DEFAULTS, PACE_MAX, TRAVEL_SCALE_BP, S, bidAt, capFor, carrierAvg, carrierTrajectory, city, dayProfit, legacyQuote, lira, marginalTable, pickPlot, prod, ref, systemJobs, trajectory, truck,
  type ModelOpts,
} from "./model";

const lines: string[] = [];
const problems: string[] = [];
const out = (...l: string[]) => lines.push(...l);
const o2: ModelOpts = { ...DEFAULTS, competitors: 2, scaledCap: true };

out("# Denge simülasyonu (v3)", "",
  `Başlangıç parası ${lira(BigInt(S.startingCash))}. Model: \`packages/economy/sim/model.ts\` (sistem doygunluk eğrileri, N rakip oyuncu, navlun, kalite, yatırım). Para kuruş/bigint; tablo ₺ gösterir.`,
  "Varsayılanlar: N = 2 oyuncu aynı pazarı paylaşır, sistem alış fiyatı kalite ölçekli üst sınırla, girdiler oyunculardan (alış ile satış arası orta fiyat + navlun) ya da sistemden en ucuzuna.", "");

// ── 1. İlk iş ──
out("## 1. İlk iş (tempo tavanı 60 dk, seviye 1, tek parti, girdiler sistemden satın alınsa bile, N = 1)", "", "| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | Gelir (navlun, komisyon sonrası) | Kâr |", "|---|---|---|---|---|---|---|---|");
const firstJobs: Array<[string, string, string]> = [
  ["crop", "yesilova", "field"], ["crop", "kavsak", "field"], ["livestock", "akyayla", "barn"], ["livestock", "yesilova", "barn"],
  ["mining", "demirdag", "mine"], ["mining", "kavsak", "mine"], ["manufacturing", "korfezkent", "food_plant"], ["manufacturing", "demirdag", "steel_mill"],
];
for (const [sector, cid, bt] of firstJobs) {
  for (const r of RECIPES.filter((x) => x.buildingType === bt)) {
    const plot = pickPlot(bt, cid, r);
    if (!plot) continue;
    const d = dayProfit(r.id, cid, 1, { ...DEFAULTS, competitors: 1, scaledCap: true, inputMode: "system" });
    const upkeep = BigInt(BUILDING_TYPES.find((x) => x.id === bt)!.levels[0]!.upkeepPerDay);
    const plan = d.firstJobProfit;
    out(`| ${sector} | ${city(cid).name.tr} | ${r.name.tr} | ${Math.min(r.minutes, PACE_MAX)} dk | ${lira(d.firstJobCost)} | ${r.output.kg} kg | ${lira(d.firstJobCost + plan)} | ${lira(plan)} |`);
    if (plan <= 0n) problems.push(`ilk iş zararda: ${sector}/${cid}/${r.id} (${lira(plan)})`);
    else if (plan < upkeep) problems.push(`ilk iş günlük bakımı karşılamıyor: ${r.id}`);
    if (d.firstJobCost > BigInt(S.startingCash) - BigInt(plot.price)) problems.push(`ilk iş başlangıç parasıyla karşılanamıyor: ${r.id}`);
  }
}
// bağış girdileri
for (const [key, items] of Object.entries(S.starterInputs)) {
  if (!items.length) continue;
  const bt = key === "crop" ? "field" : key === "livestock" ? "barn" : key === "manufacturing_food_plant" ? "food_plant" : "steel_mill";
  const ok = RECIPES.some((r) => r.buildingType === bt && r.inputs.every((i) => (items.find((x) => x.productId === i.productId)?.kg ?? 0) >= i.kg));
  if (!ok) problems.push(`bağış girdileri ilk partiyi karşılamıyor: ${key}`);
}
out("", "Bağış girdileri (tohum 400 kg, yem 3000 kg, tahıl 2000 kg, cevher 2000 + kömür 1000 kg) her sektörde en az bir tam partiyi karşılar.");

// ── 2. Sektör kârları ──
out("", "## 2. Sektör kârı (günlük işletme kârı ve 21 gün, N = 2, kalite ölçekli üst sınır, yatırımlar açgözlü)", "",
  "21 günlük yörünge: her gün nakit yeterse geri dönüşü en kısa yatırım (bina seviyesi, tesis kalitesi, araştırma) alınır. Kâr = gelir − girdi − enerji/su/işçilik − bina bakımı.", "",
  "| Sektör | Günlük kâr L1 | L2 | L3 | 21 gün işletme kârı | Yatırım harcaması | Alınan yatırımlar |", "|---|---|---|---|---|---|---|");
const ops: Record<string, bigint> = {};
for (const a of AGENTS) {
  const t = trajectory(a, o2);
  const row = [1, 2, 3].map((l) => lira(dayProfit(a.recipeId, a.cityId, l, o2).profit));
  ops[a.key] = t.operating;
  out(`| ${a.label} | ${row.join(" | ")} | ${lira(t.operating)} | ${lira(t.spent)} | ${t.bought.join(", ")} |`);
}
const ft = carrierTrajectory(2, "v3");
const ftOld = carrierTrajectory(2, "v2");
ops.freight = ft.operating;
const fj = carrierAvg("v3", 2, 40, 1);
out(`| Taşımacılık: kamyon, sistem işleri (N = 2) | ${lira(fj.daily)} (1 kamyon) | ${lira(carrierAvg("v3", 2, 40, 2).daily)} (2 kamyon) | ${lira(carrierAvg("v3", 2, 40, 3).daily)} (3 kamyon) | ${lira(ft.operating)} | ${lira(ft.spent)} | ${ft.bought.join(", ")} |`);
const main = ["crop", "livestock", "mining", "mfg_food", "mfg_steel", "freight"];
const best = main.reduce((a, k) => (ops[k]! > ops[a]! ? k : a));
const worst = main.reduce((a, k) => (ops[k]! < ops[a]! ? k : a));
const ratio = Number(ops[best]!) / Number(ops[worst]!);
out("", `Beş sektörün temsilcileri (tarım, hayvancılık, madencilik, imalat-un, imalat-çelik, taşımacılık) arasında en yüksek / en düşük 21 gün işletme kârı = ${lira(ops[best]!)} (${best}) / ${lira(ops[worst]!)} (${worst}) = ${ratio.toFixed(2)}×. Hedef ≤ 2,2×.`);
if (ratio > 2.2) problems.push(`sektör kârları dengesiz: ${ratio.toFixed(2)}×`);
for (const k of main) if (ops[k]! <= 0n) problems.push(`sektör kârsız: ${k}`);
out("", "Rakip sayısına duyarlılık (21 gün işletme kârı, ₺): bina seviyesi 3 yalnızca pazarı tek başına dolduran oyuncuya yarar.", "", "| Sektör | N = 1 | N = 2 | N = 3 |", "|---|---|---|---|");
for (const a of AGENTS.filter((x) => ["crop", "livestock", "mining", "mfg_food", "mfg_steel"].includes(x.key))) {
  out(`| ${a.label} | ${[1, 2, 3].map((n) => lira(trajectory(a, { ...o2, competitors: n }).operating)).join(" | ")} |`);
}
out(`| Taşımacılık (kamyon) | ${[1, 2, 3].map((n) => lira(carrierTrajectory(n, "v3").operating)).join(" | ")} |`);

// ── 3. H1 kalite ──
out("", "## 3. H1: kalite primi (sistem alış fiyatı kuruş/kg, tahıl, doygunluk 0)", "", "| Şehir | Kalite | Eski (cap kaliteden sonra) | Yeni (cap kalite 2 tabanında) | Eski prim vs kalite 2 | Yeni prim |", "|---|---|---|---|---|---|");
for (const cid of ["korfezkent", "yesilova", "kavsak"]) {
  const b = (q: number, sc: boolean) => bidAt("grain", cid, q, 0, 1, sc);
  for (const q of [2, 3, 4, 5]) out(`| ${city(cid).name.tr} | ${q} | ${b(q, false)} | ${b(q, true)} | %${(Number(b(q, false) * 100n) / Number(b(2, false)) - 100).toFixed(0)} | %${(Number(b(q, true) * 100n) / Number(b(2, true)) - 100).toFixed(0)} |`);
}
out("", "Sistem satışı yalnızca kalite 2'dir; kalite ancak üretimle elde edilir. Aşağıdaki denetim her ürün, şehir ve kalite için normalleştirilmiş alışın (alış × kalite 2 çarpanı / kalite çarpanı) en düşük sistem satış fiyatının altında kaldığını doğrular.");
let arb = 0;
out("", "## 4. Sistem arbitraj denetimi (kalite ölçekli üst sınırla)", "");
for (const p of PRODUCTS) {
  const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[p.id] ?? 0) > 0);
  const buyers = SYSTEM_PROFILES.filter((x) => (x.buys[p.id] ?? 0) > 0);
  if (!sellers.length || !buyers.length) continue;
  const minAsk = sellers.map((s) => systemAsk(ref(p.id, s.cityId), S.system.askBp, 0, 1)).reduce((a, b) => (b < a ? b : a));
  let worstN = 0n;
  for (const b of buyers) for (const q of [1, 2, 3, 4, 5]) {
    const v = bidAt(p.id, b.cityId, q, 0, b.buys[p.id]!, true);
    const norm = (v * BigInt(QUALITY_PRICE_BP[2]!)) / BigInt(QUALITY_PRICE_BP[q]!);
    if (norm > worstN) worstN = norm;
    const c = systemContractPrice(systemBid(ref(p.id, b.cityId), S.system.bidBp, 0, b.buys[p.id]!, capFor(p.id)), minAsk, 10000, 10000);
    if (c >= minAsk) { arb++; problems.push(`sözleşme fiyatı sistem satışına ulaşıyor: ${p.id}`); }
  }
  const ok = worstN < minAsk;
  if (!ok) { arb++; problems.push(`arbitraj: ${p.id}`); }
  out(`- ${p.name.tr}: en yüksek normalleştirilmiş sistem alış ${worstN} < en düşük sistem satış ${minAsk} kuruş/kg → ${ok ? "zarar (doğru)" : "KÂRLI (HATA)"}`);
}

// ── 5. Yatırım geri dönüşü ──
out("", "## 5. H6: yatırım geri dönüşü (başlangıç durumu: seviye 1, kalite 1, araştırma 0; N = 2)", "", "| Sektör | Yatırım | Maliyet | Günlük kazanç | Geri dönüş (gün) |", "|---|---|---|---|---|");
const firstBest = new Set<string>();
for (const a of AGENTS.filter((x) => !["mining_iron", "mfg_milk", "mfg_cheese"].includes(x.key))) {
  const t = marginalTable(a, { level: 1, facQ: 1, resQ: 0, resYield: 0 }, o2);
  const sorted = t.filter((x) => x.payback !== null).sort((x, y) => x.payback! - y.payback!);
  firstBest.add(sorted[0]!.id.replace(/\d/g, ""));
  for (const x of t) out(`| ${a.label} | ${x.label}${x === sorted[0] ? " (en kısa)" : ""} | ${lira(x.cost)} | ${lira(x.gain)} | ${x.payback ?? "—"} |`);
}
out("", `Her sektörün en kısa geri dönüşlü ilk yatırımı farklı olabilir: ${[...firstBest].join(", ")}. ${firstBest.size >= 2 ? "Tek bir hep-en-iyi yol yok." : "UYARI: tek en iyi yol."}`);
if (firstBest.size < 2) problems.push("her sektörde aynı yatırım en iyi");
for (const a of AGENTS.filter((x) => ["crop", "livestock", "mining", "mfg_food", "mfg_steel"].includes(x.key))) {
  const t = marginalTable(a, { level: 1, facQ: 1, resQ: 0, resYield: 0 }, o2);
  const l2 = t.find((x) => x.id === "L2");
  if (!l2 || l2.payback === null || l2.payback > 14) problems.push(`bina seviye 2 geri dönüşü yok/uzun: ${a.key}`);
}

// ── 6. Taşımacılık ──
out("", "## 6. H4: taşımacılık tarifesi (kamyon 12 t, 15.000 kuruş/sa ücret)", "", `Eski tarife: (taban ${S.freight.systemBaseFee} + km × ${S.freight.systemPerKm}) × kamyon dolusu, sistem işleri hep 4 t. Yeni: mesafe sınırı, kısmi yük, hacim indirimi, süre primi, yükleme-boşaltma ${S.freight.handlingMinutes} dk.`, "",
  "| Rota | Yük | Eski ücret | Eski saat başı kâr | Yeni ücret | Yeni saat başı kâr |", "|---|---|---|---|---|---|");
for (const [a, b, kg] of [["kavsak", "yesilova", 12000], ["kavsak", "demirdag", 12000], ["korfezkent", "demirdag", 12000], ["kavsak", "demirdag", 4000], ["kavsak", "demirdag", 6000], ["korfezkent", "yesilova", 9000]] as const) {
  const km = roadDistanceKm(a, b);
  const t0 = estimateOwnTrip(km, truck, BigInt(city(a).wage), { paceScaleBp: TRAVEL_SCALE_BP });
  const t1 = estimateOwnTrip(km, truck, BigInt(city(a).wage), { handlingMinutes: S.freight.handlingMinutes, paceScaleBp: TRAVEL_SCALE_BP });
  const q0 = legacyQuote(km, kg), q1 = systemCarrierQuote(km, kg, S.freight.systemBaseFee, S.freight.systemPerKm);
  out(`| ${city(a).name.tr} → ${city(b).name.tr} (${km} km) | ${kg / 1000} t | ${lira(q0)} | ${lira(((q0 - t0.total) * 60n) / BigInt(t0.minutes))} | ${lira(q1)} | ${lira(((q1 - t1.total) * 60n) / BigInt(t1.minutes))} |`);
}
out("", `Eski tarifede 4 t'luk iş dolu kamyon kadar öder ve kâr/saat rotaya bakmaksızın yakın; yeni tarifede 4–6 t zararına yakındır, dolu kamyon kazanır (kısmi yük pahalıya gelir). Kamyonet (3 t) sistem işlerini eskiden hiç alamıyordu (iş 4 t); yeni karışımda 2,5 t işler kamyonetlidir. Günlük sistem işi ${CITIES.length * SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY} (şehir başına ${SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY}); N = 2 taşımacı, kamyon başına günlük kâr ${lira(carrierAvg("v3", 2, 40, 1).daily)} (eski ${lira(carrierAvg("v2", 2, 0, 1).daily)}); 21 gün: yeni ${lira(ft.operating)}, eski ${lira(ftOld.operating)}.`);
out("", "Sistem işi örneği (yeni karışım, gün 0, Kavşak çıkışlı):", "", "| Hedef | Yük | Süre | Ücret | Kamyon maliyeti | Saat başı kâr |", "|---|---|---|---|---|---|");
for (const j of systemJobs("v3", 0, 40).filter((x) => x.from === "kavsak")) out(`| ${city(j.to).name.tr} | ${j.kg / 1000} t | ${j.deadlineH} sa | ${lira(j.pay)} | ${lira(j.cost)} | ${j.kg > truck.capacityKg ? "kamyon sığmaz (tır)" : lira(j.pth)} |`);

out("", "### Taşımacı kararı: uzun dolu sefer mi, kısa iş mi (tur = gidiş + dönüş, saat başı kâr)", "");
const legPay = (km: number, kg: number, dl = 24) => { const q = systemCarrierQuote(km, kg, S.freight.systemBaseFee, S.freight.systemPerKm); return q + (q * BigInt(deadlinePremiumBp(dl))) / 10000n; };
const W = BigInt(city("kavsak").wage);
const tripOpts = { handlingMinutes: S.freight.handlingMinutes, waitMinutes: 20, paceScaleBp: TRAVEL_SCALE_BP };
const kd = roadDistanceKm("kavsak", "demirdag"), ky = roadDistanceKm("kavsak", "yesilova");
const longOut = { km: kd, kg: 12000, pay: legPay(kd, 12000) }, shortOut = { km: ky, kg: 12000, pay: legPay(ky, 12000) };
const flipCarrier = (setName: string, longBack: { km: number; kg: number; pay: bigint } | null, shortBack: { km: number; kg: number; pay: bigint } | null) => {
  const L = roundTripValue(longOut, longBack, truck, W, tripOpts), Sx = roundTripValue(shortOut, shortBack, truck, W, tripOpts);
  const win = L.profitPerHour > Sx.profitPerHour ? "UZUN" : "KISA";
  out(`- ${setName}: uzun (Kavşak→Demirdağ ${kd} km, 12 t, dönüş ${longBack ? longBack.kg / 1000 + " t" : "boş + 20 dk bekleme"}) tur kârı ${lira(L.profit)}, ${(L.minutes / 60).toFixed(1)} sa, ${lira(L.profitPerHour)}/sa; kısa (Kavşak→Yeşilova ${ky} km, 12 t, dönüş ${shortBack ? shortBack.kg / 1000 + " t" : "boş + 20 dk bekleme"}) tur kârı ${lira(Sx.profit)}, ${(Sx.minutes / 60).toFixed(1)} sa, ${lira(Sx.profitPerHour)}/sa → **${win} kazanır**.`);
  return win;
};
const cA = flipCarrier("Küme A (dönüş yükü yalnızca kısa rotada)", null, { km: ky, kg: 12000, pay: legPay(ky, 12000) });
const cB = flipCarrier("Küme B (dönüş yükü yalnızca uzun rotada: Demirdağ çelik/kömür)", { km: kd, kg: 12000, pay: legPay(kd, 12000) }, null);
if (cA === cB) problems.push("taşımacı kararı çevrilmiyor");
const nowDeadline = (dl: number) => { const L = roundTripValue({ ...longOut, pay: legPay(kd, 12000, dl) }, null, truck, W, tripOpts); return L; };
out(`- Süre primi: uzun sefer acil (6 sa) ücreti ${lira(legPay(kd, 12000, 6))} (+%30), 12 sa ${lira(legPay(kd, 12000, 12))} (+%15), 24 sa ${lira(legPay(kd, 12000, 24))}, 48 sa ${lira(legPay(kd, 12000, 48))} (−%5): aracı o an boşta olan acil işi alırsa tur kârı ${lira(nowDeadline(6).profit)} (24 sa: ${lira(nowDeadline(24).profit)}).`);

// ── 7. Çiftçi: spot ya da sözleşme ──
out("", "## 7. H5: çiftçi, spot ya da sistem sözleşmesi (tahıl, Yeşilova, 3 taksit × 2000 kg, 24 sa arayla)", "");
{
  const pid = "grain", cid = "yesilova";
  const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[pid] ?? 0) > 0);
  const minAsk = sellers.map((s) => systemAsk(ref(pid, s.cityId), S.system.askBp, 0, 1)).reduce((a, b) => (b < a ? b : a));
  const B = SYSTEM_PROFILES.find((p) => p.companyKey === "wholesale_yesilova")!.buys[pid]!;
  const cap = capFor(pid);
  const run = (name: string, o: { fill: number; drift: number; quality: number; miss: number; sat: number }) => {
    const r = refPrice(prod(pid).basePricePerKg, city(cid).priceBp[pid]!, o.drift);
    const contractPrice = systemContractPrice(systemBid(refPrice(prod(pid).basePricePerKg, city(cid).priceBp[pid]!, 10000), S.system.bidBp, 0, B, cap), minAsk, 9500, o.sat);
    const spot = [0, 1, 2].map(() => bidAt(pid, cid, o.quality, Math.floor(B * o.fill), B, true, o.drift));
    void r;
    const res = contractVsSpot({
      qtyPerInstallmentKg: 2000, installments: 3, contractPricePerKg: contractPrice, spotPricePerKg: spot, missProbBp: o.miss, penaltyBp: 1000, depositDays: 3,
      dailyInterestBp: S.loan.dailyInterestBp, contractFreightPerKg: 0n, spotFreightPerKg: 0n, spotFeeBp: S.marketFeeBp,
    });
    out(`- ${name}: sözleşme ${contractPrice} kuruş/kg (kalite fark etmez), spot ${spot[0]} kuruş/kg (doluluk %${Math.round(o.fill * 100)}, sapma ${o.drift / 100}%, kalite ${o.quality}), teslim edememe %${o.miss / 100} → sözleşme ${lira(res.contractValue)} vs spot ${lira(res.spotValue)} → **${res.better === "contract" ? "SÖZLEŞME" : "SPOT"}** (fark ${lira(res.advantage)}).`);
    return res.better;
  };
  const a = run("Küme A (pazar doygun: rakipler günlük talebin %80'ini doldurdu, kalite 2)", { fill: 0.8, drift: 10000, quality: 2, miss: 500, sat: 8000 });
  const b = run("Küme B (pazar boş, referans %20 yukarı kaymış, kalite 4 stok)", { fill: 0.1, drift: 12000, quality: 4, miss: 500, sat: 1000 });
  if (a === b) problems.push("spot/sözleşme kararı çevrilmiyor");
  out("", `Sistem sözleşme fiyatı = doygunluksuz sistem alışı × (1 + %3 + doygunluğun %12'si + itibar payı), en çok en düşük sistem satışının %95'i. Doygun pazarda sözleşme spotu geçer; boş pazarda spot, kayma ve yüksek kalite sözleşmeyi geçer. Ceza (%10) ve teminat faizi sözleşmenin bedelidir.`);
}

// ── 8. İmalatçı: tedarikçi ──
out("", "## 8. H3: imalatçı, yakın pahalı mı uzak ucuz mu (un fabrikası Körfezkent, tahıl)", "");
{
  const offers = (qty: number) => [
    { id: "Körfezkent toptan (0 km)", pricePerKg: systemAsk(ref("grain", "korfezkent"), S.system.askBp, 0, 1), km: 0, availableKg: 4000, fromSystem: true },
    { id: "Yeşilova çiftçisi (180 km)", pricePerKg: 480n, km: roadDistanceKm("yesilova", "korfezkent"), availableKg: qty },
  ];
  const wage = BigInt(city("yesilova").wage);
  for (const [name, qty] of [["Küme A: 3.000 kg (kısmi yük)", 3000], ["Küme B: 12.000 kg (dolu kamyon)", 12000]] as const) {
    const c = chooseSupplier(offers(qty), qty, truck, wage, { handlingMinutes: S.freight.handlingMinutes, baseFee: S.freight.systemBaseFee, perKm: S.freight.systemPerKm });
    const o = offers(qty).filter((x) => x.availableKg >= qty).map((x) => chooseSupplier([x], qty, truck, wage, { handlingMinutes: S.freight.handlingMinutes, baseFee: S.freight.systemBaseFee, perKm: S.freight.systemPerKm })!);
    out(`- ${name}: ${o.map((x, i) => `${offers(qty)[i]!.id} ${x.perKg} kuruş/kg (navlun ${lira(x.freight)})`).join(" | ")} → **${c!.id}**.`);
  }
  const cA = chooseSupplier(offers(3000), 3000, truck, wage, { handlingMinutes: 40, baseFee: S.freight.systemBaseFee, perKm: S.freight.systemPerKm })!.id;
  const cB = chooseSupplier(offers(12000), 12000, truck, wage, { handlingMinutes: 40, baseFee: S.freight.systemBaseFee, perKm: S.freight.systemPerKm })!.id;
  if (cA === cB) problems.push("tedarikçi kararı çevrilmiyor");
  const f = (id: string, n: number) => dayProfit("mill_flour", "korfezkent", 1, { ...o2, competitors: n, inputMode: id as "system" | "p2p" }).profit;
  out("", `Un fabrikası seviye 1, günlük kâr: yalnızca sistem girdisi ${lira(f("system", 2))}, oyuncu tedarikli ${lira(f("p2p", 2))}. Sistem toptancı günlük satışı sınırlıdır (Körfezkent tahıl ${SYSTEM_PROFILES.find((p) => p.companyKey === "wholesale_korfezkent")!.sells.grain} kg) ve doldukça %20'ye kadar pahalanır, bu yüzden oyuncu tedariki gerçek bir seçenektir.`);
  if (f("p2p", 2) <= f("system", 2)) problems.push("oyuncu tedarikli girdi sistemden kârlı değil");
}

// ── 9. Sistem bütçesi ──
out("", "## 9. Sistem bütçesi", "", "| Şirket | Günlük bütçe | Nominal alım değeri (kalite 2) | Kalite 5 üst sınırı |", "|---|---|---|---|");
let sumB = 0n, sumP = 0n;
for (const p of SYSTEM_PROFILES) {
  let p2 = 0n, p5 = 0n;
  for (const [pid, kg] of Object.entries(p.buys)) { p2 += bidAt(pid, p.cityId, 2, 0, kg, true) * BigInt(kg); p5 += bidAt(pid, p.cityId, 5, 0, kg, true) * BigInt(kg); }
  sumB += BigInt(p.dailyBudget); sumP += p2;
  out(`| ${p.name.tr} | ${lira(BigInt(p.dailyBudget))} | ${lira(p2)} | ${lira(p5)} |`);
  if (BigInt(p.dailyBudget) < p5) problems.push(`bütçe kalite 5 talebini karşılamıyor: ${p.companyKey}`);
}
let spend = 0n;
for (const a of AGENTS.filter((x) => ["crop", "livestock", "mining", "mfg_food", "mfg_steel"].includes(x.key))) spend += dayProfit(a.recipeId, a.cityId, 2, o2).revenue * 2n;
spend += BigInt(CITIES.length * SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY) * legPay(100, 12000) / 2n;
out("", `Toplam günlük bütçe tavanı ${lira(sumB)}; nominal alım değeri ${lira(sumP)}. Beklenen gerçek harcama (5 sektörden 2'şer oyuncu, seviye 2, + taşıma işleri): yaklaşık ${lira(spend)} (tavanın %${Number((spend * 100n) / sumB)}'i). Sistem parayı yalnızca oyuncu üretimine karşılık basar; bütçe tavandır, hedef değil.`);

out("", problems.length ? `## SORUNLAR\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "## Sonuç\n\nTüm denetimler geçti: ilk iş her sektörde kârlı ve bağışla karşılanır, beş sektör de 21 günde kâr eder (en yüksek / en düşük ≤ 2,2×), sistem arbitrajı yok, spot/sözleşme, tedarikçi ve taşımacı kararları parametreyle çevrilir.");
const outPath = fileURLToPath(new URL("../../../docs/economy/denge.md", import.meta.url));
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (problems.length || arb) process.exit(1);
