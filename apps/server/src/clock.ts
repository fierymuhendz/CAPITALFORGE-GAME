/**
 * Sunucunun tek saat kaynağı. Üretimde ofset her zaman 0. Test ortamında (ALLOW_TIME_TRAVEL)
 * world_clock.offset_ms ile ileri alınabilir. Ekonomi formülleri saate erişmez; zaman parametre olarak geçer.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { worldClock } from "./db/schema";
import { fail } from "./errors";

export class Clock {
  private offsetMs = 0;
  constructor(private readonly allowTravel: boolean, private readonly base: () => number = () => Date.now()) {}

  now(): Date {
    return new Date(this.base() + this.offsetMs);
  }
  nowMs(): number {
    return this.base() + this.offsetMs;
  }

  async load(db: Db): Promise<void> {
    const r = await db.select().from(worldClock).where(eq(worldClock.id, 1)).limit(1);
    this.offsetMs = this.allowTravel ? (r[0]?.offsetMs ?? 0) : 0;
  }

  async advance(db: Db, ms: number): Promise<Date> {
    if (!this.allowTravel) fail("TIME_TRAVEL_DISABLED");
    await db
      .insert(worldClock)
      .values({ id: 1, offsetMs: ms })
      .onConflictDoUpdate({ target: worldClock.id, set: { offsetMs: sql`${worldClock.offsetMs} + ${ms}` } });
    await this.load(db);
    return this.now();
  }
}
