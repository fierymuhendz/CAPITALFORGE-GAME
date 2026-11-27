/**
 * Zincir kârlılığı (saf): her tarif için girdiler referans fiyatla (oyuncudan) alınırsa ve çıktı sisteme (bid; ara malda %75, nihai malda %85)
 * ya da oyuncuya (referans, %1 komisyon) satılırsa parti kârı. Her şehir ayrı denenir, en kötü şehir raporlanır (navlun yok: pazar
 * simülasyonu navlunu ayrıca hesaplar). Bakım payı = günlük bakım / 12 parti (fiyat türetmedeki varsayım).
 */
import { BUILDING_TYPES, CITIES, RECIPES, SYSTEM_PROFILES, profileBidBp, type RecipeDef } from "@capitalforge/shared";
import { applyBp, planProduction } from "../src/index";
import { S, ref, capFor } from "./model";

export interface ChainRow {
  recipeId: string; research: boolean; worstCity: string;
  /** kuruş, en kötü şehirde */
  playerProfit: bigint; systemProfit: bigint | null; inputCost: bigint; opCost: bigint; playerMarginBp: number;
}

const hasSystemBuyer = (pid: string) => SYSTEM_PROFILES.some((p) => (p.buys[pid] ?? 0) > 0);

/** ürünü alan sistem şirketlerinin en yüksek teklif oranı (bp): nihai mal %85, sanayi ofisinin ara mal teklifi %75 */
export function systemBidBpFor(pid: string): number {
  return SYSTEM_PROFILES.filter((p) => (p.buys[pid] ?? 0) > 0).reduce((a, p) => Math.max(a, profileBidBp(p, pid, S.system.bidBp)), 0);
}

export function chainRow(r: RecipeDef): ChainRow {
  const bt = BUILDING_TYPES.find((b) => b.id === r.buildingType)!;
  const sysBuyer = hasSystemBuyer(r.output.productId);
  let worst: ChainRow | null = null;
  for (const c of CITIES) {
    const one = planProduction(r, {
      batches: 1, plotYieldBp: 10000, cityYieldBp: 10000, researchYieldBp: 0, researchEfficiencyBp: 0, facilityQualityLevel: 1, researchQualityLevels: 0,
      laborAvailabilityBp: c.labor.availability, inputLots: [], prices: { energyPerKwh: BigInt(c.energyPrice), waterPerM3: BigInt(c.waterPrice), wagePerHour: BigInt(c.wage) },
    });
    const inputCost = r.inputs.reduce((a, i) => a + ref(i.productId, c.id) * BigInt(i.kg), 0n);
    const opCost = one.energyCost + one.waterCost + one.laborCost + BigInt(bt.levels[0]!.upkeepPerDay) / 12n;
    const outRef = ref(r.output.productId, c.id) * BigInt(r.output.kg);
    const playerProfit = applyBp(outRef, 10000 - S.marketFeeBp) - inputCost - opCost;
    let systemProfit: bigint | null = null;
    if (sysBuyer) {
      let bid = applyBp(ref(r.output.productId, c.id), systemBidBpFor(r.output.productId));
      const cap = capFor(r.output.productId);
      if (cap !== null && bid > cap) bid = cap;
      systemProfit = applyBp(bid * BigInt(r.output.kg), 10000 - S.marketFeeBp) - inputCost - opCost;
    }
    const cost = inputCost + opCost;
    const row: ChainRow = { recipeId: r.id, research: !!r.research, worstCity: c.id, playerProfit, systemProfit, inputCost, opCost, playerMarginBp: cost > 0n ? Number((playerProfit * 10000n) / cost) : 0 };
    if (!worst || row.playerProfit < worst.playerProfit) worst = row;
  }
  return worst!;
}

export const chainRows = (): ChainRow[] => RECIPES.map(chainRow);
