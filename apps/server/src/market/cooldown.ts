import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { players } from "../db/schema";

/**
 * Yeni hesap bekleme süresinin bittiği an (yalnızca gösterim). Gerçek denetim executeTrade içinde,
 * veritabanı now() ile yapılır. delay 0 ise oluşturulma anı döner (zaten geçmiştir).
 */
export async function tradeUnlockAt(db: Db, playerId: string, delaySeconds: number): Promise<Date> {
  const [p] = await db.select({ createdAt: players.createdAt }).from(players).where(eq(players.id, playerId));
  return new Date((p?.createdAt.getTime() ?? 0) + delaySeconds * 1000);
}
