import { nextPrice } from "@capitalforge/economy";
import { asc, eq } from "drizzle-orm";
import { EventEmitter } from "node:events";
import type { Db } from "../db/client";
import { priceHistory, products } from "../db/schema";
import type { Redis } from "../redis";

export const TICK_INTERVAL_MS = 1000;
export const TICK_LOCK_KEY = "market:tick";
export const TICK_LOCK_PX = 900;
export const TICK_CHANNEL = "market:ticks";

export interface ProductTick {
  productId: string;
  /** kuruş, string */
  price: string;
  tick: number;
}

/** Süreç içi yayın: odalar buraya abone olur. Redis pub/sub bunu diğer süreçlerden besler. */
export const tickBus = new EventEmitter();
tickBus.setMaxListeners(0);
export const TICK_EVENT = "tick";

/**
 * Tek tick: ürünleri id sırasıyla kilitler (ticaret yalnızca tek ürün kilitler, deadlock yok),
 * nextPrice uygular, bekleyen talep/arzı sıfırlar, price_history yazar. Commit sonrası sonuç döner.
 */
export async function runTick(db: Db): Promise<ProductTick[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(products).orderBy(asc(products.id)).for("update");
    const out: ProductTick[] = [];
    for (const p of rows) {
      const price = nextPrice(p.price, p.pendingDemand, p.pendingSupply);
      const tick = p.tick + 1n;
      await tx
        .update(products)
        .set({ price, tick, pendingDemand: 0n, pendingSupply: 0n })
        .where(eq(products.id, p.id));
      await tx.insert(priceHistory).values({ productId: p.id, tick, price }).onConflictDoNothing();
      out.push({ productId: p.id, price: price.toString(), tick: Number(tick) });
    }
    return out;
  });
}

/**
 * Tick döngüsü. Çok örnekli çalışmada Redis kilidi (SET NX PX 900) ile saniyede en çok bir örnek tick atar.
 * Commit sonrası sonuç Redis kanalına yayınlanır (aboneler tickBus'a aktarır).
 */
export function startTicker(db: Db, redis: Redis): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const got = await redis.set(TICK_LOCK_KEY, "1", "PX", TICK_LOCK_PX, "NX");
      if (got !== "OK") return;
      const ticks = await runTick(db);
      await redis.publish(TICK_CHANNEL, JSON.stringify(ticks));
    } catch (err) {
      console.error("tick hatası", err);
    } finally {
      running = false;
    }
  }, TICK_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** Redis kanalını dinleyip tickBus'a aktarır. Kapatma fonksiyonu döner. */
export async function bridgeTicks(sub: Redis): Promise<() => Promise<void>> {
  await sub.subscribe(TICK_CHANNEL);
  sub.on("message", (channel, message) => {
    if (channel !== TICK_CHANNEL) return;
    try {
      tickBus.emit(TICK_EVENT, JSON.parse(message) as ProductTick[]);
    } catch {
      /* bozuk mesajı yok say */
    }
  });
  return async () => {
    await sub.unsubscribe(TICK_CHANNEL);
    sub.disconnect();
  };
}
