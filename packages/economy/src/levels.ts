/** Seviye: deneyim eşiklerine göre (levelXp[i] = seviye i+1 için gereken toplam puan). */
export function levelForXp(xp: number, levelXp: readonly number[]): number {
  let lvl = 1;
  for (let i = 0; i < levelXp.length; i++) if (xp >= (levelXp[i] ?? Infinity)) lvl = i + 1;
  return lvl;
}
export function nextLevelXp(xp: number, levelXp: readonly number[]): number | null {
  for (const t of levelXp) if (t > xp) return t;
  return null;
}
/** İtibar: zamanında tam teslim oranı, bp. Veri yoksa nötr 8000. Laplace düzeltmesi. */
export function reputationBp(onTime: number, lateOrMissed: number): number {
  return Math.round(((onTime + 4) / (onTime + lateOrMissed + 5)) * 10000);
}
