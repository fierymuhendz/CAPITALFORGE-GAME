import type { ProductId } from "./params";
import { executeAgainstPool, initialPool, poolMaxOrder, replenish } from "./pool";

/**
 * Pump-and-dump saldırgan modeli (test/sim amaçlı, saf), ortak havuza karşı. Denge durumundaki
 * havuzda nBuyTicks boyunca her tick en çok qPerTick (emir sınırıyla kırpılı) alır, waitTicks
 * bekler, sonra stoğu tick başına bir emirle satar (en çok horizon tick; kalanı son fiyatla tasfiye
 * edilemez, sıfır değerli sayılır). Her tick havuz yenilenir. Dönüş: kâr (kuruş, negatif = zarar).
 */
export function pumpProfit(
  pid: ProductId,
  qPerTick: bigint,
  nBuyTicks: number,
  waitTicks: number,
  horizon: number,
): bigint {
  let pool = initialPool(pid);
  let cash = 0n;
  let held = 0n;
  const end = nBuyTicks + waitTicks + horizon;
  for (let t = 0; t < end; t++) {
    pool = replenish(pool, pid, 1n);
    if (t < nBuyTicks) {
      const q = qPerTick < poolMaxOrder(pool) ? qPerTick : poolMaxOrder(pool);
      if (q > 0n) {
        const r = executeAgainstPool("buy", pool, q);
        cash += r.playerDelta;
        held += q;
        pool = r.newPool;
      }
    } else if (t >= nBuyTicks + waitTicks && held > 0n) {
      const q = held < poolMaxOrder(pool) ? held : poolMaxOrder(pool);
      const r = executeAgainstPool("sell", pool, q);
      cash += r.playerDelta;
      held -= q;
      pool = r.newPool;
    }
  }
  return cash; // kalan stok değersiz sayılır (muhafazakâr)
}
