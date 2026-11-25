/** İnşaat ve yükseltme bitiş görevleri: FOR UPDATE SKIP LOCKED, durum geçişi aynı işlemde (tam bir kez). */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { facilities } from "../db/schema";
import type { Tx } from "../db/client";
import type { Deps } from "../deps";
import { withTx } from "../deps";
import type { UnitOfWork } from "../events/bus";
import { notify } from "../lib/notify";

async function completeConstruction(tx: Tx, uow: UnitOfWork, id: string, now: Date): Promise<boolean> {
  const f = (
    await tx
      .select()
      .from(facilities)
      .where(and(eq(facilities.id, id), eq(facilities.state, "constructing"), lte(facilities.constructionEndsAt, now)))
      .for("update", { skipLocked: true })
  )[0];
  if (!f) return false;
  await tx.update(facilities).set({ state: "ready" }).where(eq(facilities.id, f.id));
  await notify(tx, uow, f.companyId, "construction_done", { building: f.type, city: f.cityId }, now, "/play?tab=facilities");
  uow.invalidate(f.companyId, "company", "facilities", "map");
  uow.world("map");
  return true;
}

async function completeUpgrade(tx: Tx, uow: UnitOfWork, id: string, now: Date): Promise<boolean> {
  const f = (
    await tx
      .select()
      .from(facilities)
      .where(and(eq(facilities.id, id), isNotNull(facilities.upgradeKind), lte(facilities.upgradeEndsAt, now)))
      .for("update", { skipLocked: true })
  )[0];
  if (!f || !f.upgradeKind || !f.upgradeTarget) return false;
  const patch = f.upgradeKind === "level" ? { level: f.upgradeTarget } : { qualityLevel: f.upgradeTarget };
  await tx.update(facilities).set({ ...patch, upgradeKind: null, upgradeTarget: null, upgradeEndsAt: null }).where(eq(facilities.id, f.id));
  await notify(
    tx, uow, f.companyId, f.upgradeKind === "level" ? "upgrade_done" : "quality_upgrade_done",
    f.upgradeKind === "level" ? { building: f.type, city: f.cityId, level: f.upgradeTarget } : { building: f.type, city: f.cityId, quality: f.upgradeTarget },
    now, "/play?tab=facilities",
  );
  uow.invalidate(f.companyId, "company", "facilities", "map");
  uow.world("map");
  return true;
}

export async function facilityCompletionTask(deps: Deps, now: Date): Promise<number> {
  let n = 0;
  const cons = await deps.db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.state, "constructing"), lte(facilities.constructionEndsAt, now)))
    .limit(200);
  for (const c of cons) {
    try {
      if (await withTx(deps, (tx, uow) => completeConstruction(tx, uow, c.id, now))) n++;
    } catch (err) {
      deps.log.error({ err, facilityId: c.id }, "inşaat bitişi işlenemedi");
    }
  }
  const ups = await deps.db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(isNotNull(facilities.upgradeKind), lte(facilities.upgradeEndsAt, now)))
    .limit(200);
  for (const u of ups) {
    try {
      if (await withTx(deps, (tx, uow) => completeUpgrade(tx, uow, u.id, now))) n++;
    } catch (err) {
      deps.log.error({ err, facilityId: u.id }, "yükseltme bitişi işlenemedi");
    }
  }
  return n;
}
