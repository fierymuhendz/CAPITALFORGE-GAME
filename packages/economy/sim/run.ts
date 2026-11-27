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
  AGENTS, DEFAULTS, PACE_MAX, TRAVEL_SCALE_BP, S, bidAt, buyersOf, capFor, carrierAvg, carrierTrajectory, city, dayProfit, legacyQuote, lira, marginalTable, pickPlot, prod, ref, sellersOf, systemJobs, trajectory, truck,
  type ModelOpts,
} from "./model";
import { chainRow, chainRows, systemBidBpFor } from "./chain";
import {
  BASE_LINES, CATALOG_TUNING, EVENT_FROM, EVENT_TO, SCENARIOS, buildProfiles, roundTripAudit, runMarket, smallTradeAudit,
  type MarketResult, type ScenarioSpec, type Tuning, type Win,
} from "./market";

const lines: string[] = [];
const problems: string[] = [];
const out = (...l: string[]) => lines.push(...l);
const o2: ModelOpts = { ...DEFAULTS, competitors: 2, scaledCap: true };

out("# Denge simülasyonu (v3)", "",
  `Başlangıç parası ${lira(BigInt(S.startingCash))}. Model: \`packages/economy/sim/model.ts\` (sistem doygunluk eğrileri, N rakip oyuncu, navlun, kalite, yatırım). Para kuruş/bigint; tablo ₺ gösterir.`,
  "Varsayılanlar: N = 2 oyuncu aynı pazarı paylaşır, sistem alış fiyatı kalite ölçekli üst sınırla, girdiler oyunculardan (alış ile satış arası orta fiyat + navlun) ya da sistemden en ucuzuna.", "");

// ── 1. İlk iş ──
// Denetim yalnızca başlangıçta yapılabilen tariflere uygulanır: girdisi başlangıç hediyesiyle ya da sistem toptancısından alınabilen (ya da girdisiz),
// araştırma kilidi olmayan ve çıktısını sistemin tek partide emebildiği tarifler. Diğerleri aşağıda "zincir kârlılığı" bölümünde değerlendirilir.
const GIFT_KEY: Record<string, string> = { field: "crop", barn: "livestock", food_plant: "manufacturing_food_plant", steel_mill: "manufacturing_steel_mill" };
out("## 1. İlk iş (tempo tavanı 60 dk, seviye 1, tek parti, girdiler sistemden satın alınsa bile, N = 1)", "",
  "Kapsam: girdisi hediye edilen ya da sistem toptancısında satılan (ya da girdisiz), araştırma kilidi olmayan ve çıktısını sistem alıcılarının günlük talebi tek partide karşılayabilen tarifler. Kapsam dışı tarifler (girdisi oyuncudan gelen, araştırma kilitli, çıktısı yalnızca oyunculara satılan ara mallar) bölüm 10'daki zincir kârlılığında denenir.", "",
  "| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | Gelir (navlun, komisyon sonrası) | Kâr |", "|---|---|---|---|---|---|---|---|");
const firstJobs: Array<[string, string, string]> = [
  ["crop", "yesilova", "field"], ["crop", "kavsak", "field"], ["livestock", "akyayla", "barn"], ["livestock", "yesilova", "barn"],
  ["mining", "demirdag", "mine"], ["mining", "kavsak", "mine"], ["manufacturing", "korfezkent", "food_plant"], ["manufacturing", "demirdag", "steel_mill"],
];
const skipped = new Map<string, Set<string>>();
const skip = (why: string, id: string) => skipped.set(why, (skipped.get(why) ?? new Set()).add(id));
let firstJobCount = 0;
for (const [sector, cid, bt] of firstJobs) {
  for (const r of RECIPES.filter((x) => x.buildingType === bt)) {
    const plot = pickPlot(bt, cid, r);
    if (!plot) continue;
    const gift = S.starterInputs[GIFT_KEY[bt] ?? ""] ?? [];
    if (r.research) { skip("araştırma kilitli", r.id); continue; }
    if (!r.inputs.every((i) => (gift.find((g) => g.productId === i.productId)?.kg ?? 0) >= i.kg || sellersOf(i.productId).length > 0)) { skip("girdisi sistemde satılmıyor (oyuncudan gelir)", r.id); continue; }
    if (buyersOf(r.output.productId).reduce((a, b) => a + b.dailyKg, 0) < r.output.kg) { skip("sistem günlük talebi tek partiden küçük (oyunculara satılan ara mal)", r.id); continue; }
    firstJobCount++;
    const d = dayProfit(r.id, cid, 1, { ...DEFAULTS, competitors: 1, scaledCap: true, inputMode: "system" });
    const upkeep = BigInt(BUILDING_TYPES.find((x) => x.id === bt)!.levels[0]!.upkeepPerDay);
    const plan = d.firstJobProfit;
    out(`| ${sector} | ${city(cid).name.tr} | ${r.name.tr} | ${Math.min(r.minutes, PACE_MAX)} dk | ${lira(d.firstJobCost)} | ${r.output.kg} kg | ${lira(d.firstJobCost + plan)} | ${lira(plan)} |`);
    if (plan <= 0n) problems.push(`ilk iş zararda: ${sector}/${cid}/${r.id} (${lira(plan)})`);
    else if (plan < upkeep) problems.push(`ilk iş günlük bakımı karşılamıyor: ${r.id}`);
    if (d.firstJobCost > BigInt(S.startingCash) - BigInt(plot.price)) problems.push(`ilk iş başlangıç parasıyla karşılanamıyor: ${r.id}`);
  }
}
if (firstJobCount < 12) problems.push(`ilk iş kapsamı çok dar: ${firstJobCount} tarif`);
out("", `Kapsam dışı (${[...skipped.values()].reduce((a, v) => a + v.size, 0)} tarif): ${[...skipped].map(([why, ids]) => `${why}: ${[...ids].join(", ")}`).join("; ")}.`);
// bağış girdileri
for (const [key, items] of Object.entries(S.starterInputs)) {
  if (!items.length) continue;
  const bt = key === "crop" ? "field" : key === "livestock" ? "barn" : key === "manufacturing_food_plant" ? "food_plant" : "steel_mill";
  const ok = RECIPES.some((r) => r.buildingType === bt && r.inputs.every((i) => (items.find((x) => x.productId === i.productId)?.kg ?? 0) >= i.kg));
  if (!ok) problems.push(`bağış girdileri ilk partiyi karşılamıyor: ${key}`);
}
out("", "Bağış girdileri (tohum 400 kg, yem 3000 kg, tahıl 2000 kg, cevher 2000 + kömür 1000 kg) her sektörde en az bir tam partiyi karşılar. Maden arsası seçimi `depositFits` ile binanın kabul ettiği yatağa bakar.", "");

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

// ── 10. Zincir kârlılığı ──
out("", "## 10. Zincir kârlılığı (her tarif, her şehir; en kötü şehir)", "",
  "Her tarifin bir partisi: girdiler referans fiyatla (oyuncudan) alınır; çıktı (a) sisteme bid fiyatından (nihai mal %85, sanayi ofisinin ara mal teklifi %75, üst sınır dahil) ya da (b) oyuncuya referans fiyattan, %1 komisyonla satılır. Maliyet = girdi + enerji + su + işçilik + günlük bakımın 1/12'si. Navlun yok (pazar simülasyonu ayrıca hesaplar).", "");
const CHAIN_OLD: Record<string, { inputs: Array<[string, number]>; out: number }> = {
  milk_cows_silage: { inputs: [["silage", 900], ["hay", 300]], out: 1150 },
  mix_compound_feed_cotton: { inputs: [["barley", 600], ["cottonseed", 400], ["bran", 200]], out: 1150 },
  mix_compound_feed_beet: { inputs: [["barley", 700], ["molasses", 150], ["beet_pulp", 350]], out: 1150 },
  pack_milk_carton: { inputs: [["raw_milk", 1000], ["milk_carton", 40]], out: 1000 },
  make_yogurt_sheep: { inputs: [["sheep_milk", 800]], out: 950 },
  make_cheese_sheep: { inputs: [["sheep_milk", 1200], ["salt", 20]], out: 220 },
  make_pickles_cannery: { inputs: [["pepper", 700], ["salt", 50], ["glass_jar", 100]], out: 850 },
  build_pallet_beam: { inputs: [["timber_beam", 220], ["fasteners", 3]], out: 200 },
  build_crate_ply: { inputs: [["plywood", 140], ["fasteners", 2]], out: 150 },
  convert_steel: { inputs: [["pig_iron", 1100], ["limestone", 100]], out: 1000 },
  machine_parts_cast: { inputs: [["castings", 350], ["lubricant", 5]], out: 300 },
  cut_gears_cast: { inputs: [["castings", 260], ["lubricant", 3]], out: 220 },
  blend_biodiesel_tallow: { inputs: [["tallow", 800], ["methanol", 100], ["caustic_soda", 10]], out: 820 },
  cook_glue_hide: { inputs: [["hide", 100]], out: 150 },
  refine_lubricant_tallow: { inputs: [["tallow", 300], ["caustic_soda", 10]], out: 220 },
  fire_brick_charcoal: { inputs: [["clay", 2000], ["charcoal", 120]], out: 1800 },
};
/** Bilinçli istisna: geri dönüşüm tarifi kâr döngüsü (karton → hamur → kraft → karton) kurmasın diye kütle korunur; karton hamurdan ~3 kat pahalı olduğundan zararlı kalır. */
const CHAIN_EXEMPT: Record<string, string> = { recycle_pulp: "kütle korunumu: çıktı ≤ girdi; karton fiyatı hamurun ~2,9 katı, kâr yapınca karton-kraft-hamur döngüsü kütle üretirdi" };
const crows = chainRows();
const pct = (bp: number) => `%${(bp / 100).toFixed(1)}`;
const fmtIn = (xs: Array<[string, number]>) => xs.map(([id, kg]) => `${id} ${kg}`).join(" + ");
out("| Düzeltilen tarif | Eski (girdi → çıktı kg) | Yeni | Oyuncuya satış marjı eski → yeni | Sisteme satış kârı eski → yeni (₺/parti) | En kötü şehir |", "|---|---|---|---|---|---|");
for (const [id, old] of Object.entries(CHAIN_OLD)) {
  const r = RECIPES.find((x) => x.id === id)!;
  const before = chainRow({ ...r, inputs: old.inputs.map(([productId, kg]) => ({ productId, kg })), output: { ...r.output, kg: old.out } });
  const after = crows.find((x) => x.recipeId === id)!;
  out(`| ${id} | ${fmtIn(old.inputs)} → ${old.out} | ${fmtIn(r.inputs.map((i) => [i.productId, i.kg]))} → ${r.output.kg} | ${pct(before.playerMarginBp)} → ${pct(after.playerMarginBp)} | ${before.systemProfit === null ? "—" : lira(before.systemProfit)} → ${after.systemProfit === null ? "—" : lira(after.systemProfit)} | ${city(after.worstCity).name.tr} |`);
}
const negPlayer = crows.filter((r) => r.playerProfit < 0n);
const negSystem = crows.filter((r) => r.systemProfit !== null && r.systemProfit < 0n);
const margins = crows.map((r) => r.playerMarginBp).sort((a, b) => a - b);
out("", `${crows.length} tarifin ${crows.length - negPlayer.length}'i oyuncuya referans fiyattan satışta, ${crows.filter((r) => r.systemProfit !== null).length - negSystem.length}/${crows.filter((r) => r.systemProfit !== null).length}'i sistem teklifiyle kârlı. Oyuncuya satış marjı en düşük ${pct(margins[0]!)}, ortanca ${pct(margins[Math.floor(margins.length / 2)]!)}. Bilinçli istisna: ${Object.entries(CHAIN_EXEMPT).map(([k, v]) => `${k} (${v})`).join("; ")}.`);
for (const r of negPlayer) if (!CHAIN_EXEMPT[r.recipeId]) problems.push(`zincir: ${r.recipeId} oyuncuya satışta zararlı (${lira(r.playerProfit)}/parti, ${r.worstCity})`);
for (const r of negSystem) if (!CHAIN_EXEMPT[r.recipeId]) problems.push(`zincir: ${r.recipeId} sistem teklifiyle zararlı (${lira(r.systemProfit!)}/parti, ${r.worstCity})`);
void systemBidBpFor;

// ── 11. Pazar simülasyonu ──
const BEFORE: Tuning = { ...CATALOG_TUNING, budget: { ...CATALOG_TUNING.budget, finalMinBatchesPerCity: 0 } };
const spec = (sc: ScenarioSpec) => `${sc.name} / ${sc.event === "shortage" ? "kıtlık" : "fazla üretim"}`;
const FOCUS: Record<string, string[]> = { shortage: ["barley", "corn", "compound_feed", "raw_milk"], surplus: ["iron_ore", "steel", "rebar", "coal"] };
const wk: Win[] = ["A", "B", "C"];
const sumW = (r: MarketResult, f: (w: Win) => number) => wk.reduce((a, w) => a + f(w), 0);
const priceIdx = (r: MarketResult, w: Win[], pid: string): string => {
  let v = 0n, rv = 0n;
  for (const x of w) { const st = r.win[x].products.get(pid); if (st) { v += st.p2p.value + st.sysBuy.value + st.internal.value; rv += st.p2p.refValue + st.sysBuy.refValue + st.internal.refValue; } }
  return rv > 0n ? `%${Number((v * 1000n) / rv) / 10}` : "—";
};
const lastIdx = (r: MarketResult, x: Win, pid: string): string => { const st = r.win[x].products.get(pid); return st?.last && st.lastRef > 0n ? `%${Number((st.last * 1000n) / st.lastRef) / 10}` : "—"; };
const delayOf = (r: MarketResult, w: Win[], pid?: string): number => {
  let kg = 0, h = 0;
  for (const x of w) for (const [id, st] of r.win[x].products) if (!pid || id === pid) { kg += st.delayKg; h += st.delayKgH; }
  return kg > 0 ? h / kg : NaN;
};
const fillOf = (r: MarketResult, w: Win[]) => {
  let p = 0, f = 0;
  for (const x of w) { const W = r.win[x]; p += W.sellPostedKg + W.buyPostedKg; f += W.sellFilledKg + W.buyFilledKg; }
  return p > 0 ? f / p : NaN;
};
const p2pShare = (r: MarketResult): number => {
  let p = 0, t = 0;
  for (const x of wk) for (const st of r.win[x].products.values()) { p += st.p2p.kg; t += st.p2p.kg + st.sysBuy.kg + st.sysSell.kg + st.internal.kg; }
  return t > 0 ? p / t : 0;
};
const prodPerDay = (r: MarketResult, x: Win, pid: string) => Math.round((r.win[x].products.get(pid)?.producedKg ?? 0) / 2);
const fx = (v: number, d = 1) => (Number.isNaN(v) ? "—" : v.toFixed(d));
const IND_TR: Record<string, string> = { field_crops: "tarla ürünleri", feed: "yem", livestock: "hayvancılık", dairy_food: "süt-gıda", textile: "tekstil", mining_metal: "maden-metal" };
const runs = SCENARIOS.map((sc) => ({ sc, after: runMarket(sc, CATALOG_TUNING), before: runMarket(sc, BEFORE) }));
const lineCount = BASE_LINES.length;
out("", "## 11. Pazar simülasyonu (ajan tabanlı, 7 gün, saatlik adım, sabit tohum)", "",
  `Model: \`packages/economy/sim/market.ts\`. Sistem şirketleri (sınırlı günlük arz, bütçeli talep, oyuncular arası 24 sa hacme göre \`systemShareFactorBp\` ile küçülme, saatlik referans kayması) ve N oyuncu; ${lineCount} üretim hattı (arpa, mısır, karma yem, süt, paketli süt, tahıl, un, demir, kömür, çelik, inşaat demiri, patates, yem bitkili süt, pamuk çırçırı, iplik, havlu, fındık hasadı, fındık kavurma), tek kopya (1 ve 4 oyuncu) ya da iki kopya (16 oyuncu). Hatlar oyunculara sırayla dağıtılır; tek oyuncuda hepsi aynı kişidedir ve aralarındaki alışveriş "iç aktarım" sayılır (sistem payını azaltmaz, sunucudaki bağlantı grubu kuralı). Alıcı ve satıcı emirleri yaşlandıkça birbirine yaklaşır (alış %85'ten saatte %3 yükselir; satış sistemin net alışına +%20'den 8 saatte iner), eşleşmede fiyat ortadadır, alıcı navlunu (kendi kamyonu), satıcı %1 komisyonu öder; satıcı sistemin net alışına ulaşınca ya da alıcı sistem satışının teslim maliyetine ulaşınca sistemle işlem yapılır. Saat 0-24 ısınma; A = saat 24-72 normal, B = saat ${EVENT_FROM}-${EVENT_TO} olay, C = ${EVENT_TO}-168 toparlanma.`, "",
  `Olaylar. Kıtlık: arpa ve mısır hatları B boyunca kapalı, bu hatların satılmamış stoğu yok olur, sistem depolarının arpa/mısır arzı %70 kesilir. Fazla üretim: demir, kömür, çelik ve inşaat demiri hatlarının kapasitesi B boyunca 3 katına çıkar.`, "");
out("### 11.1 Senaryo ölçüleri (katalog değerleriyle)", "",
  "Fiyat endeksi = gerçekleşen satış fiyatı / aynı şehirde taban referans (kayma 10000, %100 = referans); ort = pencere ağırlıklı ortalama, son = pencerenin son satışı. Satış süresi = çıktının üretimden satışa kg ağırlıklı saati. Dolan emir oranı = doldurulan kg / verilen emir kg (alış + satış). p2p payı = oyuncular arası kg / tüm işlem kg. Sistemin bastığı para = sistemin oyunculara ödediği − oyunculardan aldığı, ₺/gün.", "",
  "| Senaryo | Odak ürün | Fiyat ort (A → B → C) | Fiyat son (B) | Satış süresi sa (A → B → C) | Dolan emir A → B | p2p payı | En kârlı iş kolu ₺/hat-gün | En zayıf iş kolu | Sistem net para ₺/gün |", "|---|---|---|---|---|---|---|---|---|---|");
for (const { sc, after: r } of runs) {
  const pid = sc.event === "shortage" ? "compound_feed" : "steel";
  const ind = r.industryProfit.slice().sort((a, b) => Number(b.profitPerLineDay - a.profitPerLineDay));
  const net = (r.totals.sysPaid - r.totals.sysReceived) / 7n;
  out(`| ${spec(sc)} | ${prod(pid).name.tr} | ${priceIdx(r, ["A"], pid)} → ${priceIdx(r, ["B"], pid)} → ${priceIdx(r, ["C"], pid)} | ${lastIdx(r, "B", pid)} | ${fx(delayOf(r, ["A"], pid))} → ${fx(delayOf(r, ["B"], pid))} → ${fx(delayOf(r, ["C"], pid))} | ${fx(fillOf(r, ["A"]), 2)} → ${fx(fillOf(r, ["B"]), 2)} | %${fx(p2pShare(r) * 100, 0)} | ${IND_TR[ind[0]!.industry] ?? ind[0]!.industry} ${lira(ind[0]!.profitPerLineDay)} | ${IND_TR[ind[ind.length - 1]!.industry] ?? ind[ind.length - 1]!.industry} ${lira(ind[ind.length - 1]!.profitPerLineDay)} | ${lira(net)} |`);
}
out("", "### 11.2 Olay etkisi (zincir ürünleri)", "", "Üretim kg/gün (A / B / C), fiyat endeksi ort (A / B / C), satış süresi sa (A / B / C).", "",
  "| Senaryo | Ürün | Üretim kg/gün | Fiyat ort | Satış süresi sa |", "|---|---|---|---|---|");
for (const { sc, after: r } of runs) {
  for (const pid of FOCUS[sc.event]!) {
    out(`| ${spec(sc)} | ${prod(pid).name.tr} | ${wk.map((x) => prodPerDay(r, x, pid)).join(" / ")} | ${wk.map((x) => priceIdx(r, [x], pid)).join(" / ")} | ${wk.map((x) => fx(delayOf(r, [x], pid))).join(" / ")} |`);
  }
}
out("", "### 11.3 İş kolu kârlılığı (₺/hat-gün, 7 gün; kâr = gelir − girdi − enerji/su/işçilik − bakım − navlun − komisyon + kapanış stoğu maliyetle)", "",
  `| Senaryo | ${Object.values(IND_TR).join(" | ")} |`, `|---|${Object.values(IND_TR).map(() => "---").join("|")}|`);
for (const { sc, after: r } of runs) out(`| ${spec(sc)} | ${Object.keys(IND_TR).map((k) => lira(r.industryProfit.find((x) => x.industry === k)?.profitPerLineDay ?? 0n)).join(" | ")} |`);

// önce / sonra
const finalsBelow = (t: Tuning) => {
  let below = 0, n = 0;
  const profs = buildProfiles(t);
  for (const p of PRODUCTS.filter((x) => x.stage === "final")) {
    const rec = RECIPES.find((x) => !x.research && x.output.productId === p.id);
    const kg = profs.filter((x) => x.src.companyKey.startsWith("retail_") || x.src.companyKey.startsWith("industry_")).reduce((a, x) => a + (x.buys[p.id] ?? 0), 0);
    if (!rec || kg <= 0) continue;
    n++;
    if (kg / rec.output.kg < 1) below++;
  }
  return { below, n, budget: profs.reduce((a, x) => a + x.budget, 0n) };
};
const fb = finalsBelow(BEFORE), fa = finalsBelow(CATALOG_TUNING);
out("", "### 11.4 Darboğaz ve düzeltme: önce / sonra", "",
  `Bulgu: nihai mal talebi ₺ bütçesine göre belirlendiğinden değerli ve ağır mallarda bütçe tek bir partiyi bile almıyor (${fb.n} nihai maldan ${fb.below}'inde sistem talebi, oyuncu sayısından bağımsız olarak günde 1 partinin altında; ör. sucuk 0,14, dana eti 0,24, konteyner 0,34, havlu 0,71 parti/gün); ilk parti sistem alıcısına sığmıyor, satış süresi uzuyor, hat stok sınırında boşta kalıyor. Düzeltme: \`V4_DEMAND_BUDGET.finalMinBatchesPerCity\` 0 → ${CATALOG_TUNING.budget.finalMinBatchesPerCity} (şehir başına en az bu kadar parti; iki şehirde ≥ 1,2 parti/gün). Sistem günlük bütçe tavanı ${lira(fb.budget)} → ${lira(fa.budget)}; sistem payı küçüldükçe (oyuncu hacmi arttıkça) bu destek de küçülür.`, "",
  `| Ölçü | Önce (0) | Sonra (${CATALOG_TUNING.budget.finalMinBatchesPerCity}) |`, "|---|---|---|",
  `| Sistem talebi < 1 parti/gün olan nihai mal | ${fb.below} / ${fb.n} | ${fa.below} / ${fa.n} |`);
for (const pid of ["towel", "roasted_hazelnut"]) {
  for (const { sc, after, before } of runs) {
    const prof = (r: MarketResult, key: string) => r.lineProfit.filter((x) => x.key === key).reduce((a, x) => a + x.profit, 0n);
    const key = pid === "towel" ? "towel" : "roast";
    out(`| ${spec(sc)}: ${prod(pid).name.tr} satış süresi sa / üretim kg/gün / haftalık kâr | ${fx(delayOf(before, wk, pid))} / ${prodPerDay(before, "A", pid)} / ${lira(prof(before, key))} | ${fx(delayOf(after, wk, pid))} / ${prodPerDay(after, "A", pid)} / ${lira(prof(after, key))} |`);
  }
}
for (const { sc, after, before } of runs) {
  out(`| ${spec(sc)}: tüm ürünlerde satış süresi sa / dolan emir oranı / sistem net ₺/gün | ${fx(delayOf(before, wk))} / ${fx(fillOf(before, wk), 2)} / ${lira((before.totals.sysPaid - before.totals.sysReceived) / 7n)} | ${fx(delayOf(after, wk))} / ${fx(fillOf(after, wk), 2)} / ${lira((after.totals.sysPaid - after.totals.sysReceived) / 7n)} |`);
}

// ── 11.5 denetimler
const st = smallTradeAudit(CATALOG_TUNING, 0);
const smallBad: string[] = [];
let smallTotal = 0;
for (const p of buildProfiles(CATALOG_TUNING)) {
  for (const side of ["buys", "sells"] as const) {
    for (const [pid, kg] of Object.entries(p[side])) {
      const nominal = kg + (side === "buys" ? p.sells[pid] ?? 0 : p.buys[pid] ?? 0);
      const t = Math.max(1, Math.floor(Math.min(250, nominal / 10)));
      const f = Math.max(2000, 10000 - Math.round((((t * 10000) / (t + nominal)) * CATALOG_TUNING.shareDampBp) / 10000));
      smallTotal++;
      if (f < 9000 || Math.floor((kg * f) / 10000) < 1) smallBad.push(`${p.key}/${pid}`);
    }
  }
}
const big = smallTradeAudit(CATALOG_TUNING, 1000);
const rt = roundTripAudit(CATALOG_TUNING);
out("", "### 11.5 Denetimler", "",
  `- Tek küçük işlem sistem desteğini kapatmaz: her (sistem şirketi, ürün, alış/satış) için günlük hacmin %10'u (en çok 250 kg) kadar bir oyuncu işleminden sonra destek ≥ %90 ve en az 1 kg: ${smallTotal - smallBad.length}/${smallTotal}. Destek, oyuncu payının %${CATALOG_TUNING.shareDampBp / 100}'i kadar küçülür, taban %20. Karşılaştırma: 1000 kg'lık bir oyuncu işlemi ${big.below9000}/${big.total} çifti %90'ın altına, en kötü %${(big.minFactorBp / 100).toFixed(0)}'e indirir (yine hiçbiri kapanmaz: kapanan ${big.closed.length}); küçük günlük hacimli ara mallarda bir parti bile sistem desteğini azaltır, tasarım gereği.`,
  `- Sistemden al, sisteme sat (sıfır doygunluk, kalite 2, dolu kamyon navlunu, %1 komisyon, her satış-alış şehri çifti, ${rt.pairs} çift): en iyi tur ${rt.worstPerKg} kuruş/kg (${rt.worst}) → ${rt.worstPerKg < 0n ? "zararlı (doğru)" : "KÂRLI (HATA)"}.`);
void st;
if (smallBad.length) problems.push(`küçük işlem sistem desteğini kapatıyor: ${smallBad.slice(0, 5).join(", ")}`);
if (rt.worstPerKg >= 0n) problems.push(`sistemden al-sisteme sat kâr bırakıyor: ${rt.worst} (${rt.worstPerKg} kuruş/kg)`);
const dailyBudget = buildProfiles(CATALOG_TUNING).reduce((a, x) => a + x.budget, 0n);
for (const { sc, after: r } of runs) {
  const tag = spec(sc);
  const tot = r.totals;
  if (tot.playerCash !== tot.sysPaid - tot.sysReceived - tot.fees - tot.freight - tot.ops - tot.upkeep) problems.push(`pazar sim: para korunmuyor (${tag})`);
  if (r.maxRoundTripPerKg >= 0n || r.bidAboveAsk > 0) problems.push(`pazar sim: ${tag} sistemden al-sisteme sat kârlı (${r.maxRoundTripPerKg} kuruş/kg, ${r.bidAboveAsk} gözlem)`);
  if (tot.sysPaid > (dailyBudget * 7n)) problems.push(`pazar sim: ${tag} sistem harcaması bütçe tavanını aşıyor`);
  for (const i of r.industryProfit) if (i.profitPerLineDay <= 0n) problems.push(`pazar sim: ${tag} iş kolu kârsız: ${i.industry} (${lira(i.profitPerLineDay)}/hat-gün)`);
  if (fillOf(r, ["A"]) < 0.8) problems.push(`pazar sim: ${tag} dolan emir oranı düşük (${fx(fillOf(r, ["A"]), 2)})`);
  if (delayOf(r, ["A"]) > 24) problems.push(`pazar sim: ${tag} ortalama satış süresi ${fx(delayOf(r, ["A"]))} sa > 24`);
  if (r.minShareFactorBp < 2000) problems.push(`pazar sim: ${tag} sistem katsayısı tabanın altında`);
}
out(`- Para korunumu (her senaryoda): oyuncu nakit değişimi = sistemden alınan − sisteme ödenen − komisyon − navlun − enerji/su/işçilik − bakım. Sistem harcaması 7 günde en çok ${lira(dailyBudget * 7n)} (günlük tavan ${lira(dailyBudget)}); senaryolarda gerçekleşen ${lira(runs.map((x) => x.after.totals.sysPaid).reduce((a, b) => (b > a ? b : a), 0n))} üst sınır.`);
void sumW;

out("", problems.length ? `## SORUNLAR\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "## Sonuç\n\nTüm denetimler geçti: ilk iş kapsamındaki her tarif kârlı ve bağışla/sistem girdisiyle karşılanır, beş sektör de 21 günde kâr eder (en yüksek / en düşük ≤ 2,2×), her tarif zincirde kârlıdır (istisna belgelidir), pazar simülasyonunda (1, 4, 16 oyuncu; kıtlık ve fazla üretim) her iş kolu kâr eder ve para korunur, sistem arbitrajı yok, tek küçük işlem sistem desteğini kapatmaz, spot/sözleşme, tedarikçi ve taşımacı kararları parametreyle çevrilir.");
const outPath = fileURLToPath(new URL("../../../docs/economy/denge.md", import.meta.url));
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (problems.length || arb) process.exit(1);
