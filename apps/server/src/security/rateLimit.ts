/**
 * Redis üzerinde sabit pencereli hız sınırı (oyuncu ve IP başına). Redis yoksa (yerel test)
 * bellek içi sayaç kullanılır. Redis hatasında istek reddedilmez ama günlüğe yazılır.
 */
import type { Deps } from "../deps";
import { fail } from "../errors";

const mem = new Map<string, { n: number; until: number }>();

export async function rateLimit(deps: Deps, key: string, limit: number, windowSec: number): Promise<void> {
  // Üretimde hız sınırı kapatılamaz: DISABLE_RATE_LIMIT yalnızca üretim dışında geçerli
  if (process.env.DISABLE_RATE_LIMIT === "1" && process.env.NODE_ENV !== "production") return;
  const k = `cf:rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  let n: number;
  if (deps.redis) {
    try {
      const r = await deps.redis.multi().incr(k).expire(k, windowSec + 5).exec();
      n = Number(r?.[0]?.[1] ?? 0);
    } catch (err) {
      deps.log.warn({ err }, "rate limit redis hatası");
      return;
    }
  } else {
    const now = Date.now();
    const cur = mem.get(k);
    if (!cur || cur.until < now) mem.set(k, { n: 1, until: now + windowSec * 1000 });
    else cur.n++;
    n = mem.get(k)!.n;
  }
  if (n > limit) fail("RATE_LIMITED");
}
