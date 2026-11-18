import { PARAMS, type ProductId } from "./params";
import { nextPrice, npcFlow, quoteTrade } from "./pricing";
import { volumeAllowed } from "./volume";

/**
 * Pump-and-dump saldırgan modeli (test/sim amaçlı, saf). Saldırgan nBuyTicks boyunca her tick
 * hacim sınırının izin verdiği kadar (en çok qPerTick) alır, waitTicks bekler, sonra stoğu hacim
 * sınırı elverdiğince satar (en çok horizon tick). NPC akışı dahil. Dönüş: kâr (kuruş, negatif = zarar).
 */
export function pumpProfit(
  pid: ProductId,
  qPerTick: bigint,
  nBuyTicks: number,
  waitTicks: number,
  horizon: number,
): bigint {
  const W = Number(PARAMS.volumeWindowTicks);
  const events: { t: number; q: bigint }[] = [];
  let used = 0n;
  let p = PARAMS.refPrice[pid];
  let cost = 0n;
  let revenue = 0n;
  let held = 0n;
  let head = 0;
  const end = nBuyTicks + waitTicks + horizon;
  for (let t = 0; t < end; t++) {
    while (head < events.length && events[head]!.t <= t - W) used -= events[head++]!.q;
    let d = 0n;
    let s = 0n;
    if (t < nBuyTicks) {
      let q = qPerTick;
      while (q > 0n && !volumeAllowed(used, q)) q = q > 1n ? q / 2n : 0n;
      if (q > 0n) {
        cost += -quoteTrade("buy", p, q).playerDelta;
        held += q;
        used += q;
        events.push({ t, q });
        d = q;
      }
    } else if (t >= nBuyTicks + waitTicks && held > 0n) {
      let q = held;
      while (q > 0n && !volumeAllowed(used, q)) q = q > 1n ? q / 2n : 0n;
      if (q > 0n) {
        revenue += quoteTrade("sell", p, q).playerDelta;
        held -= q;
        used += q;
        events.push({ t, q });
        s = q;
      }
    }
    const f = npcFlow(p, PARAMS.refPrice[pid], PARAMS.npcBase[pid]);
    p = nextPrice(p, d + f.demand, s + f.supply);
  }
  if (held > 0n) revenue += quoteTrade("sell", p, held).playerDelta;
  return revenue - cost;
}
