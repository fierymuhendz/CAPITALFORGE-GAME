/**
 * Araştırma: seviye n maliyeti = baseCost × n², süresi = baseMinutes × n; şirket seviyesi ≥ n olmalı.
 * Şirket başına aynı anda tek araştırma sürer (RESEARCH_BUSY). Bitişte seviye artar.
 */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { ResearchDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { companies, research } from "../db/schema";
import type { Deps } from "../deps";
import { withTx } from "../deps";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { minutesToMs, paceDuration } from "../catalog/pace";

export const researchCost = (baseCost: number, level: number): bigint => BigInt(baseCost) * BigInt(level) * BigInt(level);
export const researchMinutes = (baseMinutes: number, level: number): number => baseMinutes * level;
const paced = (c: Catalog, baseMinutes: number, level: number): number => paceDuration(c, researchMinutes(baseMinutes, level));

export async function researchView(db: Tx | Deps["db"], catalog: Catalog, companyId: string): Promise<ResearchDto> {
  const rows = await db.select().from(research).where(eq(research.companyId, companyId));
  const by = new Map(rows.map((r) => [r.researchId, r]));
  return {
    items: [...catalog.research.values()].map((d) => {
      const r = by.get(d.id);
      const level = r?.level ?? 0;
      const maxed = level >= d.maxLevel;
      return {
        researchId: d.id, level,
        nextCost: maxed ? null : m(researchCost(d.baseCost, level + 1)),
        nextMinutes: maxed ? null : paced(catalog, d.baseMinutes, level + 1),
        minCompanyLevel: maxed ? level : level + 1,
        inProgress: r?.targetLevel && r.endsAt ? { targetLevel: r.targetLevel, endsAt: r.endsAt.toISOString() } : null,
      };
    }),
  };
}

export async function startResearch(tx: Tx, uow: UnitOfWork, catalog: Catalog, companyId: string, researchId: string, now: Date): Promise<ResearchDto> {
  const def = catalog.researchDef(researchId);
  // Şirket satırı kilidi: aynı anda iki araştırma başlatılamaz
  const c = (await tx.select().from(companies).where(eq(companies.id, companyId)).for("update"))[0];
  if (!c) fail("NOT_FOUND");
  const rows = await tx.select().from(research).where(eq(research.companyId, companyId));
  if (rows.some((r) => r.endsAt && r.targetLevel)) fail("RESEARCH_BUSY");
  const level = rows.find((r) => r.researchId === researchId)?.level ?? 0;
  if (level >= def.maxLevel) fail("RESEARCH_MAXED");
  const target = level + 1;
  if (c.level < target) fail("LEVEL_TOO_LOW", { required: target });
  const cost = researchCost(def.baseCost, target);
  await post(tx, {
    kind: "research", idempotencyKey: `research:${companyId}:${researchId}:${target}`, refType: "research", refId: researchId, at: now,
    memo: `Araştırma ${researchId} → ${target}`,
    lines: [{ account: co(companyId, "exp_research"), amount: cost }, { account: co(companyId, "cash"), amount: -cost }],
  });
  const endsAt = new Date(now.getTime() + minutesToMs(paced(catalog, def.baseMinutes, target)));
  await tx
    .insert(research)
    .values({ companyId, researchId, level, targetLevel: target, endsAt })
    .onConflictDoUpdate({ target: [research.companyId, research.researchId], set: { targetLevel: target, endsAt } });
  uow.invalidate(companyId, "company", "finance", "research");
  return researchView(tx, catalog, companyId);
}

async function completeResearch(tx: Tx, uow: UnitOfWork, companyId: string, researchId: string, now: Date): Promise<boolean> {
  const r = (
    await tx
      .select()
      .from(research)
      .where(and(eq(research.companyId, companyId), eq(research.researchId, researchId), isNotNull(research.targetLevel), lte(research.endsAt, now)))
      .for("update", { skipLocked: true })
  )[0];
  if (!r || !r.targetLevel) return false;
  await tx.update(research).set({ level: r.targetLevel, targetLevel: null, endsAt: null }).where(and(eq(research.companyId, companyId), eq(research.researchId, researchId)));
  await notify(tx, uow, companyId, "research_done", { research: researchId, level: r.targetLevel }, now, "/play?tab=research");
  uow.invalidate(companyId, "company", "research");
  return true;
}

export async function researchCompletionTask(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ companyId: research.companyId, researchId: research.researchId })
    .from(research)
    .where(and(isNotNull(research.targetLevel), lte(research.endsAt, now)))
    .limit(200);
  let n = 0;
  for (const d of due) {
    try {
      if (await withTx(deps, (tx, uow) => completeResearch(tx, uow, d.companyId, d.researchId, now))) n++;
    } catch (err) {
      deps.log.error({ err, ...d }, "araştırma bitişi işlenemedi");
    }
  }
  return n;
}
