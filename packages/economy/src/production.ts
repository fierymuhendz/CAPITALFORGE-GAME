import { BP, toBig } from "./money";

export interface RecipeLike {
  inputs: Array<{ productId: string; kg: number }>;
  output: { productId: string; kg: number };
  minutes: number;
  laborHours: number;
  energyKwh: number;
  waterM3: number;
}

export interface ProductionContext {
  batches: number;
  /** arsa çarpanı: tarla verimliliği / mera / yatak zenginliği; fabrika 10000 */
  plotYieldBp: number;
  /** şehir sektör çarpanı */
  cityYieldBp: number;
  /** araştırma verim bonusu (bp, +) */
  researchYieldBp: number;
  /** araştırma verimlilik (enerji ve işçilik azaltma, bp) */
  researchEfficiencyBp: number;
  /** tesis kalite seviyesi (1..3) */
  facilityQualityLevel: number;
  /** kalite araştırması seviyesi */
  researchQualityLevels: number;
  /** şehir iş gücü durumu (bp, 10000 nötr) */
  laborAvailabilityBp: number;
  /** girdi kaliteleri: her girdi için kullanılacak lotların (kg, kalite) listesi */
  inputLots: Array<{ productId: string; kg: number; quality: number }>;
  prices: { energyPerKwh: bigint; waterPerM3: bigint; wagePerHour: bigint };
}

export interface ProductionPlan {
  inputs: Array<{ productId: string; kg: number }>;
  outputKg: number;
  outputQuality: number;
  minutes: number;
  energyKwh: number;
  waterM3: number;
  laborHours: number;
  energyCost: bigint;
  waterCost: bigint;
  laborCost: bigint;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Girdi miktarları (parti başına × parti). Verim girdileri değil çıktıyı etkiler. */
export function requiredInputs(recipe: RecipeLike, batches: number): Array<{ productId: string; kg: number }> {
  return recipe.inputs.map((i) => ({ productId: i.productId, kg: i.kg * batches }));
}

/** Kalite: girdilerin kg ağırlıklı ortalaması (yarım yukarı), girdisiz tarifte 2; + bonuslar; 1..5 */
export function outputQuality(lots: Array<{ kg: number; quality: number }>, facilityQualityLevel: number, researchQualityLevels: number): number {
  let base = 2;
  const kg = lots.reduce((a, l) => a + l.kg, 0);
  if (kg > 0) {
    const w = lots.reduce((a, l) => a + l.kg * l.quality, 0);
    base = Math.floor((w * 2 + kg) / (2 * kg)); // round half up, tam sayı aritmetiği
  }
  return clamp(base + (facilityQualityLevel - 1) + researchQualityLevels, 1, 5);
}

export function planProduction(recipe: RecipeLike, ctx: ProductionContext): ProductionPlan {
  if (!Number.isInteger(ctx.batches) || ctx.batches < 1) throw new Error("parti sayısı geçersiz");
  const b = BigInt(ctx.batches);
  const yieldNum = toBig(recipe.output.kg) * b * toBig(ctx.plotYieldBp) * toBig(ctx.cityYieldBp) * (BP + toBig(ctx.researchYieldBp));
  const outputKg = Number(yieldNum / (BP * BP * BP));
  const eff = BP - toBig(clamp(ctx.researchEfficiencyBp, 0, 5000));
  const energyKwh = Number((toBig(recipe.energyKwh) * b * eff) / BP);
  const laborHours = Number((toBig(recipe.laborHours) * b * eff) / BP);
  const waterM3 = recipe.waterM3 * ctx.batches;
  const durBp = 10000 + Math.round((10000 - ctx.laborAvailabilityBp) / 2);
  const minutes = Math.max(1, Math.ceil((recipe.minutes * clamp(durBp, 7000, 13000)) / 10000));
  return {
    inputs: requiredInputs(recipe, ctx.batches),
    outputKg,
    outputQuality: outputQuality(ctx.inputLots, ctx.facilityQualityLevel, ctx.researchQualityLevels),
    minutes,
    energyKwh,
    waterM3,
    laborHours,
    energyCost: toBig(energyKwh) * ctx.prices.energyPerKwh,
    waterCost: toBig(waterM3) * ctx.prices.waterPerM3,
    laborCost: toBig(laborHours) * ctx.prices.wagePerHour,
  };
}

/** Birim maliyet tahmini kuruş/kg (aşağı yuvarlı) */
export function unitCostPerKg(totalCost: bigint, outputKg: number): bigint {
  return outputKg > 0 ? totalCost / BigInt(outputKg) : 0n;
}
