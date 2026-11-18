import { type ProductId, poolPrice, replenish } from "@capitalforge/economy";
import { and, asc, eq, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import type { Db } from "../db/client";
import { gameClock, priceHistory, products } from "../db/schema";
import { type CompletedJob, runCompletionPhase } from "../production/complete";
import { runUpkeepPhase } from "../production/upkeep";
import type { Redis } from "../redis";

export const TICK_INTERVAL_MS = 1000;
export const TICK_LOCK_KEY = "market:tick";
export const TICK_LOCK_PX = 900;
export const TICK_CHANNEL = "market:ticks";
export const JOB_CHANNEL = "market:jobs";

export interface ProductTick {
  productId: string;
  /** kuruş, string */
  price: string;
  tick: number;
}

/** Tick yayını: ürün fiyatları ve sunucu oyun saati (istemci ilerleme çubukları buna dayanır). */
export interface TickBroadcast {
  clockTick: number;
  products: ProductTick[];
}

/** Süreç içi yayın: odalar buraya abone olur. Redis pub/sub bunu diğer süreçlerden besler. */
export const tickBus = new EventEmitter();
tickBus.setMaxListeners(0);
export const TICK_EVENT = "tick";
/** Tamamlanan üretim işleri (CompletedJob[]). */
export const JOB_EVENT = "jobCompleted";

/**
 * Fiyat fazı: ürünleri id sırasıyla kilitler (ticaret yalnızca tek ürün kilitler, deadlock yok),
 * ortak havuzu replenish ile yeniler, fiyatı havuzdan türetir,
 * price_history yazar ve oyun saatini (game_clock) aynı transaction'da bir artırır.
 */
export async function runTickFull(db: Db): Promise<TickBroadcast | null> {
  class Fenced extends Error {}
  try {
    return await db.transaction(async (tx) => {
    // Çit (fencing): saat, ürün kilitlerinden ÖNCE okunur ve yalnızca okunan değerde artırılır. Aynı tick'i
    // iki örnek (ör. Redis kilidi süresi dolmuş) paralel çalıştırırsa biri güncellemede 0 satır etkiler ve iptal olur.
    const [seen] = await tx.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
    if (!seen) throw new Error("game_clock satırı yok (seed uygulanmamış)");
    const rows = await tx.select().from(products).orderBy(asc(products.id)).for("update");
    const out: ProductTick[] = [];
    for (const p of rows) {
      // Havuz her tick referans derinliğe/değere doğru yenilenir (tek tick); fiyat havuzdan türetilir.
      const pool = replenish({ units: p.poolUnits, value: p.poolValue }, p.id as ProductId, 1n);
      const price = poolPrice(pool);
      const tick = p.tick + 1n;
      await tx
        .update(products)
        .set({ price, tick, poolUnits: pool.units, poolValue: pool.value })
        .where(eq(products.id, p.id));
      await tx.insert(priceHistory).values({ productId: p.id, tick, price }).onConflictDoNothing();
      out.push({ productId: p.id, price: price.toString(), tick: Number(tick) });
    }
    const [clock] = await tx
      .update(gameClock)
      .set({ tick: sql`${gameClock.tick} + 1` })
      .where(and(eq(gameClock.id, 1), eq(gameClock.tick, seen.tick)))
      .returning({ tick: gameClock.tick });
    if (!clock) throw new Fenced(); // başka bir işçi bu tick'i attı: fiyat yazımları dahil her şey geri alınır
    return { clockTick: Number(clock.tick), products: out };
    });
  } catch (err) {
    if (err instanceof Fenced) return null;
    throw err;
  }
}

/** Yalnızca fiyat fazının ürün sonuçları (geriye uyumlu kısa biçim). */
export async function runTick(db: Db): Promise<ProductTick[]> {
  return (await runTickFull(db))?.products ?? [];
}

export interface TickCycleResult {
  broadcast: TickBroadcast;
  completed: CompletedJob[];
  upkeepProcessed: number;
}

/**
 * Tam döngü: (1) fiyat + saat, (2) üretim tamamlama, (3) bakım. Fazlar ayrı transaction'lardır;
 * sonraki faz hata verirse fiyat tick'i geri alınmaz. Faz süreleri uzunsa günlüğe yazılır.
 */
export async function runTickCycle(db: Db, onPriceTick?: (b: TickBroadcast) => Promise<void>): Promise<TickCycleResult | null> {
  const t0 = Date.now();
  const broadcast = await runTickFull(db);
  if (!broadcast) return null; // tick başka bir işçi tarafından atıldı
  if (onPriceTick) await onPriceTick(broadcast);
  const tick = BigInt(broadcast.clockTick);

  // Her faz kendi try/catch'inde: birinin hatası diğerini durdurmaz.
  const t1 = Date.now();
  let completed: CompletedJob[] = [];
  try {
    completed = await runCompletionPhase(db, tick);
  } catch (err) {
    console.error("tamamlama fazı hatası", err);
  }
  const t2 = Date.now();
  let upkeepProcessed = 0;
  try {
    upkeepProcessed = await runUpkeepPhase(db, tick);
  } catch (err) {
    console.error("bakım fazı hatası", err);
  }
  const t3 = Date.now();
  // Döngü tick kilidinden uzun sürerse bir sonraki tick başka örnekte çakışabilir.
  if (t3 - t0 > TICK_LOCK_PX) {
    console.warn(
      `tick ${tick} kilit süresini (${TICK_LOCK_PX}ms) aştı: toplam ${t3 - t0}ms (fiyat ${t1 - t0}, tamamlama ${t2 - t1} [${completed.length} iş], bakım ${t3 - t2})`,
    );
  }
  return { broadcast, completed, upkeepProcessed };
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
      const cycle = await runTickCycle(db, async (b) => {
        await redis.publish(TICK_CHANNEL, JSON.stringify(b));
      });
      const completed = cycle?.completed ?? [];
      if (completed.length > 0) await redis.publish(JOB_CHANNEL, JSON.stringify(completed));
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
  await sub.subscribe(TICK_CHANNEL, JOB_CHANNEL);
  sub.on("message", (channel, message) => {
    try {
      if (channel === TICK_CHANNEL) tickBus.emit(TICK_EVENT, JSON.parse(message) as TickBroadcast);
      else if (channel === JOB_CHANNEL) tickBus.emit(JOB_EVENT, JSON.parse(message) as CompletedJob[]);
    } catch {
      /* bozuk mesajı yok say */
    }
  });
  return async () => {
    await sub.unsubscribe(TICK_CHANNEL, JOB_CHANNEL);
    sub.disconnect();
  };
}
