/**
 * Üretim değerlendirmesi: hem teklif (quote) hem başlatma aynı hesabı kullanır.
 * Formüller packages/economy (planProduction). Bu dosya yalnızca veriyi toplar ve engelleri sıralar.
 */
import { and, eq, sql } from "drizzle-orm";
import { planProduction, requiredInputs, type ProductionPlan } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import { paceDuration } from "../catalog/pace";
import type { DbOrTx, Tx } from "../db/client";
import { facilities, plots, productionJobs, research } from "../db/schema";
import { lockAccounts } from "../finance/locks";
import { rawBalances } from "../finance/report";
import { selectLots, type LotSelection } from "./lots";

export type FacilityRow = typeof facilities.$inferSelect;
export type PlotRow = typeof plots.$inferSelect;

export interface Blocker {
  code: string;
  productId?: string;
  missingKg?: number;
  missing?: string;
}

export interface InputEval extends LotSelection {
  productId: string;
  requiredKg: number;
}

export interface Evaluation {
  plan: ProductionPlan;
  inputs: InputEval[];
  inputsCost: bigint;
  operatingCost: bigint;
  total: bigint;
  blockers: Blocker[];
  recipe: ReturnType<Catalog["recipe"]>;
}

export async function researchLevels(db: DbOrTx, companyId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(research).where(eq(research.companyId, companyId));
  return new Map(rows.map((r) => [r.researchId, r.level]));
}

export async function evaluateProduction(
  db: DbOrTx, catalog: Catalog, companyId: string, facility: FacilityRow, recipeId: string, batches: number, lock: boolean,
): Promise<Evaluation> {
  const recipe = catalog.recipe(recipeId);
  const bt = catalog.buildingType(facility.type);
  const ld = catalog.levelDef(facility.type, facility.level);
  const city = catalog.city(facility.cityId);
  const blockers: Blocker[] = [];

  if (facility.state !== "ready") blockers.push({ code: "BUILDING_NOT_READY" });
  if (recipe.buildingType !== facility.type || recipe.minBuildingLevel > facility.level) blockers.push({ code: "RECIPE_NOT_ALLOWED" });
  const plot = (await db.select().from(plots).where(eq(plots.id, facility.plotId)).limit(1))[0];
  if (recipe.deposit && plot?.depositKind !== recipe.deposit) blockers.push({ code: "DEPOSIT_MISMATCH" });
  if (batches > ld.maxBatches) blockers.push({ code: "BATCHES_EXCEED_CAPACITY" });
  const running = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productionJobs)
    .where(and(eq(productionJobs.facilityId, facility.id), eq(productionJobs.status, "running")));
  if ((running[0]?.n ?? 0) >= ld.lines) blockers.push({ code: "NO_FREE_LINE" });

  // Arsa ve şehir çarpanları (v2-sunucu-modulleri.md genel kurallar)
  const sector = bt.sector;
  const plotYieldBp =
    sector === "crop" ? plot?.fertilityBp ?? 10000
      : sector === "livestock" ? plot?.pastureBp ?? 10000
        : sector === "mining" ? plot?.depositRichnessBp ?? 10000
          : 10000;
  const cityYieldBp = sector === "crop" || sector === "livestock" ? 10000 : city.sectorYieldBp[sector] ?? 10000;

  let researchYieldBp = 0;
  let researchEfficiencyBp = 0;
  let researchQualityLevels = 0;
  const levels = await researchLevels(db, companyId);
  for (const def of catalog.research.values()) {
    const lv = levels.get(def.id) ?? 0;
    if (lv <= 0) continue;
    const e = def.effect;
    if (e.kind === "yield" && e.sector === sector) researchYieldBp += lv * e.bpPerLevel;
    else if (e.kind === "efficiency" && e.sector === sector) researchEfficiencyBp += lv * e.bpPerLevel;
    else if (e.kind === "quality") researchQualityLevels += lv * e.perLevel;
  }

  // Girdi lotları
  const inputs: InputEval[] = [];
  const savingBp = Math.min(3000, ld.inputSavingBp ?? 0);
  const needs = new Map(requiredInputs(recipe, batches, savingBp).map((r) => [r.productId, r.kg]));
  for (const inp of recipe.inputs) {
    const need = needs.get(inp.productId) ?? inp.kg * batches;
    const sel = await selectLots(db, companyId, facility.cityId, inp.productId, need, lock);
    inputs.push({ ...sel, productId: inp.productId, requiredKg: need });
    if (sel.missingKg > 0) blockers.push({ code: "INSUFFICIENT_STOCK", productId: inp.productId, missingKg: sel.missingKg });
  }
  const plan0 = planProduction(recipe, {
    batches, plotYieldBp, cityYieldBp, researchYieldBp, researchEfficiencyBp,
    facilityQualityLevel: facility.qualityLevel + (ld.qualityBonus ?? 0), researchQualityLevels,
    levelYieldBp: ld.yieldBp ?? 0, levelEfficiencyBp: ld.efficiencyBp ?? 0, levelInputSavingBp: savingBp, laborAvailabilityBp: city.labor.availability,
    inputLots: inputs.flatMap((i) => i.lots.map((l) => ({ productId: i.productId, kg: l.kg, quality: l.quality }))),
    prices: { energyPerKwh: BigInt(city.energyPrice), waterPerM3: BigInt(city.waterPrice), wagePerHour: BigInt(city.wage) },
  });
  // tempo kuralı: süre tavanı (settings.pace); çalışan işler kayıtlı endsAt ile biter
  const plan = { ...plan0, minutes: paceDuration(catalog, plan0.minutes) };
  const inputsCost = inputs.reduce((a, i) => a + i.estCost, 0n);
  const operatingCost = plan.energyCost + plan.waterCost + plan.laborCost;

  // Nakit ve gecikmiş borç (kilitli kullanımda hesaplar kilitlenir; stoktan sonra, defter sırası)
  const bal = lock ? await lockAccounts(db as Tx, companyId, ["cash", "arrears"]) : await rawBalances(db, companyId);
  if ((bal.arrears ?? 0n) < 0n) blockers.push({ code: "ARREARS_OUTSTANDING" });
  const cash = bal.cash ?? 0n;
  if (cash < operatingCost) blockers.push({ code: "INSUFFICIENT_FUNDS", missing: (operatingCost - cash).toString() });

  const order = ["BUILDING_NOT_READY", "RECIPE_NOT_ALLOWED", "DEPOSIT_MISMATCH", "BATCHES_EXCEED_CAPACITY", "NO_FREE_LINE", "ARREARS_OUTSTANDING", "INSUFFICIENT_STOCK", "INSUFFICIENT_FUNDS"];
  blockers.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  return { plan, inputs, inputsCost, operatingCost, total: inputsCost + operatingCost, blockers, recipe };
}
