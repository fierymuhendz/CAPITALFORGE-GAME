/**
 * Denge simülasyonu (saf, deterministik): her sektörün ilk işi ve bir haftalık tekrar ekonomisi,
 * zincir marjları, navlunun teslim maliyetine etkisi ve sistem arbitrajı denetimi.
 * Çıktı: docs/economy/denge.md. Başarısız denetimde çıkış kodu 1.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILDING_TYPES, CITIES, DEFAULT_SETTINGS, PLOTS, PRODUCTS, RECIPES, SYSTEM_PROFILES, VEHICLE_MODELS, roadDistanceKm,
} from "@capitalforge/shared";
import { applyBp, estimateOwnTrip, planProduction, refPrice, systemAsk, systemBid, systemBidCap } from "../src/index";

const S = DEFAULT_SETTINGS;
const lira = (k: bigint) => `₺${(Number(k) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
const city = (id: string) => CITIES.find((c) => c.id === id)!;
const prod = (id: string) => PRODUCTS.find((p) => p.id === id)!;
const ref = (pid: string, cid: string) => refPrice(prod(pid).basePricePerKg, city(cid).priceBp[pid] ?? 10000, 10000);
const ask = (pid: string, cid: string) => systemAsk(ref(pid, cid), S.system.askBp, 0, 1);
// Alış üst sınırı: tüm şehirlerdeki güncel (doygunluksuz) sistem satış fiyatlarının en düşüğünün %80'i.
const capFor = (pid: string) => {
  const sellers = SYSTEM_PROFILES.filter((p) => (p.sells[pid] ?? 0) > 0);
  if (!sellers.length) return null;
  return systemBidCap(sellers.map((s) => systemAsk(refPrice(prod(pid).basePricePerKg, city(s.cityId).priceBp[pid] ?? 10000, 10000), S.system.askBp, 0, 1)).reduce((a, b) => (b < a ? b : a)));
};
const bestBid = (pid: string, from: string) => {
  const buyers = SYSTEM_PROFILES.filter((p) => (p.buys[pid] ?? 0) > 0);
  const truck = VEHICLE_MODELS.find((v) => v.id === "truck")!;
  return buyers
    .map((b) => {
      const bid = systemBid(ref(pid, b.cityId), S.system.bidBp, 0, 1, capFor(pid));
      const km = roadDistanceKm(from, b.cityId);
      const trip = km ? estimateOwnTrip(km, truck, BigInt(city(from).wage)) : { total: 0n, minutes: 0 };
      return { city: b.cityId, name: b.name.tr, bid, km, trip };
    })
    .sort((a, b) => Number(b.bid - a.bid));
};

const lines: string[] = ["# Denge simülasyonu", "", `Başlangıç parası ${lira(BigInt(S.startingCash))}. Fiyatlar referans (sistem alış = ref × %${S.system.bidBp / 100}).`, ""];
const problems: string[] = [];

lines.push("## İlk iş (seviye 1, tek parti, en iyi uygun arsa)", "", "| Sektör | Şehir | Tarif | Süre | Maliyet | Çıktı | En iyi alıcı | Gelir (navlun sonrası) | Kâr |", "|---|---|---|---|---|---|---|---|---|");
const sectorCities: Array<[string, string, string]> = [
  ["crop", "yesilova", "field"], ["crop", "kavsak", "field"], ["livestock", "akyayla", "barn"], ["livestock", "yesilova", "barn"],
  ["mining", "demirdag", "mine"], ["mining", "kavsak", "mine"], ["manufacturing", "korfezkent", "food_plant"], ["manufacturing", "demirdag", "steel_mill"],
];
for (const [sector, cid, bt] of sectorCities) {
  const c = city(cid);
  const plots = PLOTS.filter((p) => p.cityId === cid && p.minLevel === 1 && p.price <= S.startingCash && (bt !== "mine" || p.deposit));
  if (!plots.length) { problems.push(`${sector}/${cid}: uygun arsa yok`); continue; }
  for (const r of RECIPES.filter((x) => x.buildingType === bt)) {
    const plot = r.deposit ? plots.find((p) => p.deposit?.kind === r.deposit) : plots[0];
    if (!plot) continue;
    const plotYield = sector === "crop" ? plot.fertilityBp : sector === "livestock" ? plot.pastureBp : sector === "mining" ? plot.deposit!.richnessBp : 10000;
    const cityYield = sector === "crop" || sector === "livestock" ? 10000 : c.sectorYieldBp[sector as "mining"] ?? 10000;
    const p = planProduction(r, {
      batches: 1, plotYieldBp: plotYield, cityYieldBp: cityYield, researchYieldBp: 0, researchEfficiencyBp: 0, facilityQualityLevel: 1,
      researchQualityLevels: 0, laborAvailabilityBp: c.labor.availability, inputLots: [],
      prices: { energyPerKwh: BigInt(c.energyPrice), waterPerM3: BigInt(c.waterPrice), wagePerHour: BigInt(c.wage) },
    });
    const inputCost = p.inputs.reduce((a, i) => a + ask(i.productId, cid) * BigInt(i.kg), 0n);
    const cost = inputCost + p.energyCost + p.waterCost + p.laborCost;
    const buyers = bestBid(r.output.productId, cid);
    const net = buyers.map((b) => ({ ...b, net: b.bid * BigInt(p.outputKg) - b.trip.total })).sort((a, b) => Number(b.net - a.net))[0];
    if (!net) { problems.push(`${r.output.productId}: sistem alıcısı yok`); continue; }
    const profit = net.net - cost;
    lines.push(`| ${sector} | ${c.name.tr} | ${r.name.tr} | ${p.minutes} dk | ${lira(cost)} | ${p.outputKg} kg | ${net.name} (${net.km} km) | ${lira(net.net)} | ${lira(profit)} |`);
    const upkeep = BigInt(BUILDING_TYPES.find((x) => x.id === bt)!.levels[0]!.upkeepPerDay);
    if (profit <= 0n) problems.push(`${sector}/${cid}/${r.id}: ilk iş zararına (${lira(profit)})`);
    else if (profit < upkeep) problems.push(`${sector}/${cid}/${r.id}: bir iş günlük bakımı (${lira(upkeep)}) karşılamıyor`);
    if (cost > BigInt(S.startingCash) - BigInt(plot.price)) problems.push(`${sector}/${cid}/${r.id}: ilk iş başlangıç parasıyla karşılanamıyor`);
  }
}

lines.push("", "## Navlun: düşük fiyat + uzak tedarikçi", "");
const truck = VEHICLE_MODELS.find((v) => v.id === "truck")!;
const near = estimateOwnTrip(roadDistanceKm("kavsak", "yesilova"), truck, 15000n);
const far = estimateOwnTrip(roadDistanceKm("kavsak", "demirdag"), truck, 15000n);
const qty = 10_000n;
lines.push(`10 t tahıl Kavşak'a: Yeşilova'dan ₺5,00/kg + navlun ${lira(near.total)} = ${lira(500n * qty + near.total)} (${near.minutes} dk); Demirdağ'dan ₺4,70/kg + navlun ${lira(far.total)} = ${lira(470n * qty + far.total)} (${far.minutes} dk).`);

lines.push("", "## Sistem arbitrajı denetimi", "");
let arb = 0;
for (const p of PRODUCTS) {
  const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[p.id] ?? 0) > 0);
  const buyers = SYSTEM_PROFILES.filter((x) => (x.buys[p.id] ?? 0) > 0);
  if (!sellers.length || !buyers.length) continue;
  const minAsk = sellers.map((s) => ask(p.id, s.cityId)).reduce((a, b) => (b < a ? b : a));
  const maxBid = buyers.map((b) => systemBid(refPrice(p.basePricePerKg, city(b.cityId).priceBp[p.id] ?? 10000, 10000), S.system.bidBp, 0, 1, capFor(p.id))).reduce((a, b) => (b > a ? b : a));
  const ok = maxBid < minAsk;
  if (!ok) { arb++; problems.push(`arbitraj: ${p.id}`); }
  lines.push(`- ${p.name.tr}: en yüksek sistem alış ${maxBid} kuruş/kg < en düşük sistem satış ${minAsk} kuruş/kg → ${ok ? "zarar (doğru)" : "KÂRLI (HATA)"}`);
}

lines.push("", "## Bina yatırım geri dönüşü (seviye 2, tam kapasite)", "");
for (const b of BUILDING_TYPES.filter((x) => x.id !== "garage")) {
  const up = b.levels[0]!;
  lines.push(`- ${b.name.tr}: yükseltme ${lira(BigInt(up.upgradeCost))} + ${up.upgradeSteelKg / 1000} t çelik (${lira(ref("steel", "korfezkent") * BigInt(up.upgradeSteelKg))}), parti kapasitesi ${up.maxBatches}→${b.levels[1]!.maxBatches}, hat ${up.lines}→${b.levels[1]!.lines}, günlük bakım ${lira(BigInt(up.upkeepPerDay))}→${lira(BigInt(b.levels[1]!.upkeepPerDay))}`);
}
lines.push("", `Piyasa komisyonu %${S.marketFeeBp / 100}; ${lira(applyBp(1_000_000n, S.marketFeeBp))} / ₺10.000.`);

lines.push("", problems.length ? `## SORUNLAR\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "## Sonuç\n\nTüm denetimler geçti: her sektörün ilk işi başlangıç parasıyla yapılabilir ve sistem alıcısına satışta bile kârlıdır (girdiler sistemden satın alınsa dahi), tek iş günlük bakımı karşılar, her çıktının sistem alıcısı var, sistem arbitrajı yok.");
const out = fileURLToPath(new URL("../../../docs/economy/denge.md", import.meta.url));
writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (problems.length || arb) process.exit(1);
