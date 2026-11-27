/**
 * Denge modeli (saf, deterministik). Her sektör için tek bir temsilci oyuncunun günlük işletme kârını hesaplar:
 * sistem alıcı/satıcı doygunluk eğrileri, N rakip oyuncu, navlun (kendi kamyonu) ve yatırım geri dönüşü.
 * Sunucu simülasyonu değildir; kataloğun ve formüllerin birlikte ne ürettiğini gösterir.
 * Para bigint kuruş; yalnızca oranlar (rakip sayısı) tam sayıdır.
 */
import {
  SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY, BUILDING_TYPES, depositFits, CITIES, DEFAULT_SETTINGS, PLOTS, PRODUCTS, QUALITY_PRICE_BP, RECIPES, RESEARCH as RESEARCH_DEFS, SYSTEM_PROFILES, VEHICLE_MODELS, roadDistanceKm,
  type PlotDef, type RecipeDef,
} from "@capitalforge/shared";
import {
  applyBp, capMinutes, estimateOwnTrip, travelScaleBp, planProduction, qualityAdjusted, refPrice, systemAsk, systemBid, systemBidCap, systemBidForQuality,
} from "../src/index";

export const S = DEFAULT_SETTINGS;
export const city = (id: string) => CITIES.find((c) => c.id === id)!;
export const prod = (id: string) => PRODUCTS.find((p) => p.id === id)!;
export const truck = VEHICLE_MODELS.find((v) => v.id === "truck")!;
export const ref = (pid: string, cid: string, driftBp = 10000) => refPrice(prod(pid).basePricePerKg, city(cid).priceBp[pid] ?? 10000, driftBp);
export const lira = (k: bigint) => `₺${(Number(k) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
/** Deneme dönemi tempo tavanı (settings.pace.maxMinutes): üretim süresi ≤ tavan, en uzun sefer ≤ 45 dk + 15 dk yükleme */
export const PACE_MAX = S.pace.maxMinutes;
export const TRAVEL_SCALE_BP = travelScaleBp(PACE_MAX, Math.ceil((250 * 60) / 60) + S.freight.handlingMinutes);
export const STEP = 250; // kg, pazar adım büyüklüğü

/** Tüm şehirlerdeki en düşük taban sistem satış fiyatının %80'i (null: sistem satıcısı yok) */
export function capFor(pid: string): bigint | null {
  const sellers = SYSTEM_PROFILES.filter((p) => (p.sells[pid] ?? 0) > 0);
  if (!sellers.length) return null;
  return systemBidCap(sellers.map((s) => systemAsk(ref(pid, s.cityId), S.system.askBp, 0, 1)).reduce((a, b) => (b < a ? b : a)));
}

/** Sistem alış fiyatı (kalite q, doluluk oranı bp=fill/10000). scaled=true: kalite ölçekli üst sınır (H1 düzeltmesi). */
export function bidAt(pid: string, cid: string, quality: number, fillKg: number, dailyKg: number, scaledCap: boolean, driftBp = 10000): bigint {
  const r = ref(pid, cid, driftBp);
  const cap = capFor(pid);
  const base = systemBid(r, S.system.bidBp, fillKg, dailyKg, cap);
  if (scaledCap) return systemBidForQuality(base, quality, cap, QUALITY_PRICE_BP);
  const v = qualityAdjusted(base, quality, QUALITY_PRICE_BP);
  return cap !== null && v > cap ? cap : v;
}

export interface Buyer { cityId: string; dailyKg: number }
export const buyersOf = (pid: string): Buyer[] => SYSTEM_PROFILES.filter((p) => (p.buys[pid] ?? 0) > 0).map((p) => ({ cityId: p.cityId, dailyKg: p.buys[pid]! }));
export const sellersOf = (pid: string): Buyer[] => SYSTEM_PROFILES.filter((p) => (p.sells[pid] ?? 0) > 0).map((p) => ({ cityId: p.cityId, dailyKg: p.sells[pid]! }));

export function freightPerKg(from: string, to: string, qtyKg = 12000): bigint {
  if (from === to) return 0n;
  const km = roadDistanceKm(from, to);
  const t = estimateOwnTrip(km, truck, BigInt(city(from).wage));
  const loads = BigInt(Math.max(1, Math.ceil(qtyKg / truck.capacityKg)));
  return (t.total * loads) / BigInt(Math.max(1, qtyKg));
}

export interface ModelOpts {
  /** aynı ürün-pazarı paylaşan oyuncu sayısı (kendisi dahil) */
  competitors: number;
  quality: number;
  scaledCap: boolean;
  /** girdi tedarik modu: sistem toptancı / oyuncu (orta fiyat) */
  inputMode: "system" | "p2p";
}
export const DEFAULTS: ModelOpts = { competitors: 2, quality: 2, scaledCap: false, inputMode: "p2p" };

/** Bir ürün için bir sonraki STEP kg'ın en iyi net satış fiyatı (navlun sonrası), kg başına; seçilen alıcıyı döndürür */
function bestSale(pid: string, from: string, soldBy: Map<string, number>, o: ModelOpts): { net: bigint; cityId: string } | null {
  let best: { net: bigint; cityId: string } | null = null;
  for (const b of buyersOf(pid)) {
    const mine = soldBy.get(b.cityId) ?? 0;
    if (mine + STEP > Math.floor(b.dailyKg / o.competitors)) continue;
    const price = bidAt(pid, b.cityId, o.quality, Math.min(b.dailyKg, mine * o.competitors), b.dailyKg, o.scaledCap);
    const net = price - freightPerKg(from, b.cityId);
    if (!best || net > best.net) best = { net, cityId: b.cityId };
  }
  return best;
}

/** Girdi kg başına teslim fiyatı. Sistem: yerel satıcı doygunluk eğrisi; p2p: alış ile satış arası orta fiyat + navlun. */
const SOURCE_CITY: Record<string, string> = { seed: "yesilova", fodder: "yesilova", grain: "yesilova", raw_milk: "akyayla", iron_ore: "demirdag", coal: "demirdag", steel: "demirdag", flour: "korfezkent" };
export function inputPrice(pid: string, cid: string, usedKg: number, o: ModelOpts): bigint {
  const sys = (() => {
    const sellers = sellersOf(pid);
    if (!sellers.length) return null;
    // yerel satıcı yoksa en yakın satıcı + navlun
    const s = sellers.slice().sort((a, b) => roadDistanceKm(a.cityId, cid) - roadDistanceKm(b.cityId, cid))[0]!;
    const per = Math.max(STEP, Math.floor(s.dailyKg / o.competitors));
    if (usedKg + STEP > per) return null;
    return systemAsk(ref(pid, s.cityId), S.system.askBp, Math.min(s.dailyKg, usedKg * o.competitors), s.dailyKg) + freightPerKg(s.cityId, cid);
  })();
  if (o.inputMode === "system" && sys !== null) return sys;
  // p2p: satıcının alternatifi (en iyi sistem alış, doygunluk %30) ile alıcının alternatifi (yerel sistem satış) ortası
  const src = SOURCE_CITY[pid] ?? cid;
  const sellerAlt = buyersOf(pid).map((b) => bidAt(pid, b.cityId, 2, Math.floor(b.dailyKg * 0.3), b.dailyKg, false) - freightPerKg(src, b.cityId)).reduce((a, b) => (b > a ? b : a), 1n);
  const buyerAlt = sellersOf(pid).length ? sellersOf(pid).map((s) => systemAsk(ref(pid, s.cityId), S.system.askBp, 0, 1) + freightPerKg(s.cityId, cid)).reduce((a, b) => (b < a ? b : a)) : sellerAlt * 2n;
  const mid = (sellerAlt + (buyerAlt > sellerAlt ? buyerAlt : sellerAlt)) / 2n;
  const p2p = mid + freightPerKg(src, cid);
  return sys !== null && sys < p2p ? sys : p2p;
}

export interface DayResult {
  batches: number; outputKg: number; revenue: bigint; cost: bigint; upkeep: bigint; profit: bigint; capacityBatches: number; marketBatches: number;
  firstJobCost: bigint; firstJobProfit: bigint; sold: Array<{ cityId: string; kg: number }>;
}

/** İlk arsa: maden için yalnızca binanın kabul ettiği (depositFits) ve tarifin istediği yatak; diğerlerinde en verimli arsa */
export function pickPlot(bt: string, cid: string, recipe: RecipeDef): PlotDef | undefined {
  const def = BUILDING_TYPES.find((x) => x.id === bt);
  const plots = PLOTS.filter((p) => p.cityId === cid && p.minLevel === 1 && p.price <= S.startingCash && (!def?.requiresDeposit || depositFits(def, p.deposit?.kind)));
  return recipe.deposit ? plots.find((p) => p.deposit?.kind === recipe.deposit) : plots.sort((a, b) => b.fertilityBp + b.pastureBp - a.fertilityBp - a.pastureBp)[0];
}

export function batchesPerDay(recipe: RecipeDef, level: number, bt: string, cid: string, minutes: number): number {
  const b = BUILDING_TYPES.find((x) => x.id === bt)!;
  const lv = b.levels[level - 1]!;
  return Math.floor((lv.lines * lv.maxBatches * 1440) / Math.max(1, minutes));
}

/** Bir tarifin günlük işletme kârı (marjinal parti parti, pazar doygunluğuyla) */
export function dayProfit(recipeId: string, cid: string, level: number, o: ModelOpts, facilityQuality = 1, researchQ = 0, researchYield = 0, researchEff = 0): DayResult {
  const r = RECIPES.find((x) => x.id === recipeId)!;
  const bt = BUILDING_TYPES.find((x) => x.id === r.buildingType)!;
  const c = city(cid);
  const plot = pickPlot(bt.id, cid, r)!;
  const sector = bt.sector;
  const plotYield = sector === "crop" ? plot.fertilityBp : sector === "livestock" ? plot.pastureBp : sector === "mining" ? plot.deposit!.richnessBp : 10000;
  const cityYield = sector === "crop" || sector === "livestock" ? 10000 : c.sectorYieldBp[sector as "mining"] ?? 10000;
  const lots = r.inputs.map((i) => ({ productId: i.productId, kg: i.kg, quality: o.quality }));
  const one = planProduction(r, {
    batches: 1, plotYieldBp: plotYield, cityYieldBp: cityYield, researchYieldBp: researchYield, researchEfficiencyBp: researchEff, facilityQualityLevel: facilityQuality + (bt.levels[level - 1]!.qualityBonus ?? 0),
    levelYieldBp: bt.levels[level - 1]!.yieldBp ?? 0, levelEfficiencyBp: bt.levels[level - 1]!.efficiencyBp ?? 0, levelInputSavingBp: bt.levels[level - 1]!.inputSavingBp ?? 0,
    researchQualityLevels: researchQ, laborAvailabilityBp: c.labor.availability, inputLots: lots,
    prices: { energyPerKwh: BigInt(c.energyPrice), waterPerM3: BigInt(c.waterPrice), wagePerHour: BigInt(c.wage) },
  });
  one.minutes = capMinutes(one.minutes, PACE_MAX);
  const q = one.outputQuality;
  const oo = { ...o, quality: q };
  const cap = batchesPerDay(r, level, bt.id, cid, one.minutes);
  const sold = new Map<string, number>();
  const used = new Map<string, number>();
  let revenue = 0n, cost = 0n, batches = 0, outKg = 0, firstCost = 0n, firstRev = 0n;
  const fixed = one.energyCost + one.waterCost + one.laborCost;
  for (let b = 0; b < cap; b++) {
    // girdi maliyeti (bu parti)
    let inCost = 0n;
    const usedNext = new Map(used);
    for (const i of one.inputs) {
      for (let k = 0; k < i.kg; k += STEP) {
        const take = Math.min(STEP, i.kg - k);
        const u = usedNext.get(i.productId) ?? 0;
        inCost += inputPrice(i.productId, cid, u, o) * BigInt(take);
        usedNext.set(i.productId, u + take);
      }
    }
    // çıktı geliri
    let rev = 0n;
    const soldNext = new Map(sold);
    let left = one.outputKg;
    while (left > 0) {
      const take = Math.min(STEP, left);
      const s = bestSale(r.output.productId, cid, soldNext, oo);
      if (!s) break;
      rev += (applyBp(s.net > 0n ? s.net : 0n, 10000 - S.marketFeeBp)) * BigInt(take);
      soldNext.set(s.cityId, (soldNext.get(s.cityId) ?? 0) + take);
      left -= take;
    }
    const batchCost = inCost + fixed;
    if (b === 0) { firstCost = batchCost; firstRev = rev; }
    if (rev <= batchCost) break;
    batches++; outKg += one.outputKg - left; revenue += rev; cost += batchCost;
    for (const [k, v] of usedNext) used.set(k, v);
    for (const [k, v] of soldNext) sold.set(k, v);
  }
  const upkeep = BigInt(bt.levels[level - 1]!.upkeepPerDay);
  return {
    batches, outputKg: outKg, revenue, cost, upkeep, profit: revenue - cost - upkeep, capacityBatches: cap, marketBatches: batches,
    firstJobCost: firstCost, firstJobProfit: firstRev - firstCost, sold: [...sold].map(([cityId, kg]) => ({ cityId, kg })),
  };
}

// ───────────────────────── Yatırım ve 21 günlük yörünge ─────────────────────────

export interface Agent { key: string; sector: string; recipeId: string; cityId: string; label: string }
export const AGENTS: Agent[] = [
  { key: "crop", sector: "crop", recipeId: "grow_grain", cityId: "yesilova", label: "Tarım: tahıl (Yeşilova)" },
  { key: "livestock", sector: "livestock", recipeId: "milk_cows", cityId: "akyayla", label: "Hayvancılık: süt (Akyayla)" },
  { key: "mining", sector: "mining", recipeId: "mine_coal", cityId: "demirdag", label: "Madencilik: kömür (Demirdağ)" },
  { key: "mining_iron", sector: "mining", recipeId: "mine_iron", cityId: "demirdag", label: "Madencilik: demir (Demirdağ)" },
  { key: "mfg_food", sector: "manufacturing", recipeId: "mill_flour", cityId: "korfezkent", label: "İmalat: un (Körfezkent)" },
  { key: "mfg_milk", sector: "manufacturing", recipeId: "pack_milk", cityId: "korfezkent", label: "İmalat: paketli süt (Körfezkent)" },
  { key: "mfg_cheese", sector: "manufacturing", recipeId: "make_cheese", cityId: "korfezkent", label: "İmalat: peynir (Körfezkent)" },
  { key: "mfg_steel", sector: "manufacturing", recipeId: "smelt_steel", cityId: "demirdag", label: "İmalat: çelik (Demirdağ)" },
];

export interface Invest { id: string; label: string; cost: bigint; apply: (st: State) => void; can: (st: State) => boolean }
export interface State { level: number; facQ: number; resQ: number; resYield: number }
export const stateProfit = (a: Agent, st: State, o: ModelOpts) => dayProfit(a.recipeId, a.cityId, st.level, o, st.facQ, st.resQ, st.resYield * 800).profit;

export function investments(a: Agent, o: ModelOpts): Invest[] {
  const r = RECIPES.find((x) => x.id === a.recipeId)!;
  const bt = BUILDING_TYPES.find((x) => x.id === r.buildingType)!;
  const steel = (kg: number) => inputPrice("steel", a.cityId, 0, { ...o, inputMode: "p2p" }) * BigInt(kg);
  const out: Invest[] = [];
  for (let L = 1; L < 3; L++) {
    const lv = bt.levels[L - 1]!;
    out.push({ id: `L${L + 1}`, label: `${bt.name.tr} seviye ${L + 1}`, cost: BigInt(lv.upgradeCost) + steel(lv.upgradeSteelKg), can: (st) => st.level === L, apply: (st) => { st.level = L + 1; } });
  }
  for (let q = 0; q < bt.qualityUpgradeCosts.length; q++) {
    out.push({ id: `Q${q + 2}`, label: `tesis kalitesi ${q + 2}`, cost: BigInt(bt.qualityUpgradeCosts[q]!), can: (st) => st.facQ === q + 1, apply: (st) => { st.facQ = q + 2; } });
  }
  const rs = (id: string) => RESEARCH_DEFS.find((x) => x.id === id)!;
  const yieldId = a.sector === "crop" ? "agronomy" : a.sector === "livestock" ? "herd_health" : a.sector === "mining" ? "drilling" : null;
  for (let n = 1; n <= 2; n++) out.push({ id: `RQ${n}`, label: `kalite kontrol ${n}`, cost: BigInt(rs("quality_control").baseCost) * BigInt(n * n), can: (st) => st.resQ === n - 1, apply: (st) => { st.resQ = n; } });
  if (yieldId) for (let n = 1; n <= 3; n++) out.push({ id: `RY${n}`, label: `${yieldId} ${n}`, cost: BigInt(rs(yieldId).baseCost) * BigInt(n * n), can: (st) => st.resYield === n - 1, apply: (st) => { st.resYield = n; } });
  return out;
}

/** Her yatırımın tek başına günlük kazancı ve geri dönüşü (mevcut duruma göre) */
export function marginalTable(a: Agent, st: State, o: ModelOpts) {
  const base = stateProfit(a, st, o);
  return investments(a, o).filter((i) => i.can(st)).map((i) => {
    const t = { ...st }; i.apply(t);
    const gain = stateProfit(a, t, o) - base;
    return { id: i.id, label: i.label, cost: i.cost, gain, payback: gain > 0n ? Number((i.cost + gain - 1n) / gain) : null };
  });
}

/** 21 günlük yörünge: her gün nakit yeterse en kısa geri dönüşlü yatırım alınır (rezerv: ilk parti maliyeti) */
export function trajectory(a: Agent, o: ModelOpts, days = 21) {
  const r = RECIPES.find((x) => x.id === a.recipeId)!;
  const plot = pickPlot(r.buildingType, a.cityId, r)!;
  let cash = BigInt(S.startingCash) - BigInt(plot.price);
  const st: State = { level: 1, facQ: 1, resQ: 0, resYield: 0 };
  let operating = 0n, spent = 0n;
  const bought: string[] = [];
  for (let d = 1; d <= days; d++) {
    const p = stateProfit(a, st, o);
    operating += p; cash += p;
    const reserve = 3_000_000n;
    const options = marginalTable(a, st, o).filter((x) => x.payback !== null && x.cost + reserve <= cash).sort((x, y) => x.payback! - y.payback!);
    const pick = options[0];
    if (pick && pick.payback! <= days - d + 6) {
      const inv = investments(a, o).find((i) => i.id === pick.id)!;
      inv.apply(st); cash -= pick.cost; spent += pick.cost; bought.push(`g${d}:${pick.id}`);
    }
  }
  return { operating, spent, net: operating - spent, bought, finalState: st };
}

// ───────────────────────── Taşımacılık ─────────────────────────
import { deadlinePremiumBp, systemCarrierQuote, systemFreightJobSpec } from "../src/index";
import { applyBp as _apply } from "../src/index";

/** Eski tarife (v2): (taban + km × km ücreti) × kamyon dolusu sayısı */
export const legacyQuote = (km: number, kg: number) => (BigInt(S.freight.systemBaseFee) + BigInt(km) * BigInt(S.freight.systemPerKm)) * BigInt(Math.max(1, Math.ceil(kg / truck.capacityKg)));

export interface FreightJob { from: string; to: string; km: number; kg: number; deadlineH: number; pay: bigint; cost: bigint; minutes: number; profit: bigint; pth: bigint }
const cityIds = CITIES.map((c) => c.id);
export function systemJobs(version: "v2" | "v3", dayIndex: number, handlingMinutes: number): FreightJob[] {
  const out: FreightJob[] = [];
  for (const from of cityIds) for (let k = 0; k < SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY; k++) {
    let kg = 4000, deadlineH = 24, to = cityIds.filter((x) => x !== from).sort()[(k + dayIndex) % 4]!;
    if (version === "v2" && k >= 4) continue;
    if (version === "v3") ({ kg, deadlineHours: deadlineH, destCityId: to } = (({ kg, deadlineHours, destCityId }) => ({ kg, deadlineHours, destCityId }))(systemFreightJobSpec(from, k, dayIndex, cityIds)));
    const km = roadDistanceKm(from, to);
    const base = version === "v3" ? systemCarrierQuote(km, kg, S.freight.systemBaseFee, S.freight.systemPerKm) : legacyQuote(km, kg);
    const pay = version === "v3" ? base + _apply(base, deadlinePremiumBp(deadlineH)) : base;
    const t = estimateOwnTrip(km, truck, BigInt(city(from).wage), { handlingMinutes, loadingHours: S.freight.driverHoursPerTrip, paceScaleBp: TRAVEL_SCALE_BP });
    out.push({ from, to, km, kg, deadlineH, pay, cost: t.total, minutes: t.minutes, profit: pay - t.total, pth: (((pay - t.total) * 60n) / BigInt(t.minutes)) });
  }
  return out;
}

/** Bir taşımacının günlük kârı: N taşımacı işleri sıra ile seçer (en yüksek saat başı kârdan); kamyon sığmayan işi alamaz; 16 saat × verim %70 */
export function carrierDay(version: "v2" | "v3", n: number, dayIndex: number, handlingMinutes: number, trucks = 1, vehicleCapKg = truck.capacityKg) {
  const jobs = systemJobs(version, dayIndex, handlingMinutes).filter((j) => j.kg <= vehicleCapKg && j.profit > 0n).sort((a, b) => Number(b.pth - a.pth));
  let minutes = 0, profit = 0n, taken = 0;
  for (let i = 0; i < jobs.length; i += n) {
    const j = jobs[i]!;
    if (minutes + j.minutes > 16 * 60 * trucks) continue;
    minutes += j.minutes; profit += j.profit; taken++;
  }
  const eff = BigInt(70);
  const upkeep = BigInt(truck.upkeepPerDay) * BigInt(trucks) + BigInt(BUILDING_TYPES.find((b) => b.id === "garage")!.levels[0]!.upkeepPerDay);
  return { jobs: taken, hours: minutes / 60, profit: (profit * eff) / 100n - upkeep, available: jobs.length };
}
export const carrierAvg = (version: "v2" | "v3", n: number, handling: number, trucks = 1) => {
  let tot = 0n, jobs = 0;
  for (let d = 0; d < 6; d++) { const r = carrierDay(version, n, d, handling, trucks); tot += r.profit; jobs += r.jobs; }
  return { daily: tot / 6n, jobsPerDay: jobs / 6 };
};

/** Taşımacı yörüngesi: nakit yetince bir kamyon daha (en çok 3); 21 gün */
export function carrierTrajectory(n: number, version: "v2" | "v3", days = 21) {
  const handling = version === "v3" ? 40 : 0;
  let trucks = 1, cash = BigInt(S.startingCash) - 5_000_000n, operating = 0n, spent = 0n;
  const bought: string[] = [];
  for (let d = 1; d <= days; d++) {
    const p = carrierAvg(version, n, handling, trucks).daily;
    operating += p; cash += p;
    if (trucks < 3 && cash >= BigInt(truck.price) + 3_000_000n) { trucks++; cash -= BigInt(truck.price); spent += BigInt(truck.price); bought.push(`g${d}:kamyon`); }
  }
  return { operating, spent, net: operating - spent, trucks, bought };
}
