/**
 * Katalog revizyonları: canlı dünyada, yönetici düzenlemediği katalog satırlarını ve ayarları BİR KEZ günceller.
 * seedWorld yalnızca eksik satır ekler; mevcut satırların varsayılanı değişirse bu mekanizma devreye girer.
 *
 * Kurallar:
 * - Her revizyon `meta` içinde `catalog.rev.<id>` anahtarıyla tek kez uygulanır (işaret + uygulama, aynı işlemde).
 * - Katalog satırı: sürüm "hiç yönetici düzenlemesi görmemiş" olmalı (version = 1 + önceki revizyonların bu satıra bindirdiği sürüm sayısı)
 *   VE her yama yolundaki güncel değer `from` (önceki gönderilen varsayılan) ile aynı olmalı. Aksi halde o yol atlanır.
 * - Ayar satırı: sürüm yok; yol yalnızca güncel değer `from` ile aynıysa değişir.
 * - Çalışan üretim işleri başlangıç tarifinin anlık görüntüsüyle (production_jobs.recipe_snapshot) biter; revizyondan etkilenmez.
 *
 * Yeni revizyon eklemek: CATALOG_REVISIONS listesinin SONUNA {id, changes} ekle; id'yi asla yeniden kullanma.
 * `patch` yolları noktalı gösterim, dizi indeksi sayıyla: "levels.0.cost", "output.kg".
 */
import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "./client";
import { catalogHistory, catalogItems, meta, settings } from "./schema";

export type CatalogKind = typeof catalogItems.$inferSelect["kind"];

export interface PathChange { path: string; from: unknown; to: unknown }
export interface RevisionChange {
  /** katalog türü ya da "setting" (id = ayarın üst düzey anahtarı) */
  kind: CatalogKind | "setting";
  id: string;
  patch: PathChange[];
}
export interface CatalogRevision { id: string; changes: RevisionChange[] }

/** Sıralı revizyon listesi (ekonomi değerleri oyun tasarımı ekibinden gelir). */
const c = (kind: CatalogKind, id: string, path: string, from: unknown, to: unknown): RevisionChange => ({ kind, id, patch: [{ path, from, to }] });

/** v3 ekonomi revizyonu (docs/plans/v3-ekonomi-kararlari.md bölüm 6): fiyatlar, tarif süreleri, seviye başına parti sayısı */
const V3_2026_11: CatalogRevision = {
  id: "v3-2026-11",
  changes: [
  c("product", "iron_ore", "basePricePerKg", 180, 260),
  c("product", "coal", "basePricePerKg", 220, 340),
  c("product", "flour", "basePricePerKg", 1050, 1300),
  c("product", "packaged_milk", "basePricePerKg", 1400, 1550),
  c("building_type", "field", "levels.0.maxBatches", 2, 1),
  c("building_type", "field", "levels.1.maxBatches", 3, 2),
  c("building_type", "field", "levels.2.maxBatches", 4, 3),
  c("building_type", "barn", "levels.0.maxBatches", 2, 1),
  c("building_type", "barn", "levels.1.maxBatches", 3, 2),
  c("building_type", "barn", "levels.2.maxBatches", 4, 3),
  c("building_type", "mine", "levels.0.maxBatches", 2, 1),
  c("building_type", "mine", "levels.1.maxBatches", 3, 2),
  c("building_type", "mine", "levels.2.maxBatches", 4, 3),
  c("building_type", "food_plant", "levels.0.maxBatches", 2, 1),
  c("building_type", "food_plant", "levels.1.maxBatches", 3, 2),
  c("building_type", "food_plant", "levels.2.maxBatches", 4, 3),
  c("building_type", "steel_mill", "levels.0.maxBatches", 2, 1),
  c("building_type", "steel_mill", "levels.1.maxBatches", 3, 2),
  c("building_type", "steel_mill", "levels.2.maxBatches", 4, 3),
  ],
};

/** v3 ekonomi revizyonu b: bina yükseltme/kalite maliyetleri, seviye bonusları (old: null = yol yoksa eklenir), araştırma maliyeti */
const V3_2026_11B: CatalogRevision = {
  id: "v3-2026-11b",
  changes: [
  c("building_type", "field", "levels.0.upgradeCost", 7000000, 2000000),
  c("building_type", "field", "levels.0.upgradeSteelKg", 3000, 1000),
  c("building_type", "field", "qualityUpgradeCosts.0", 3500000, 5000000),
  c("building_type", "field", "qualityUpgradeCosts.1", 10000000, 14000000),
  c("building_type", "field", "levels.1.yieldBp", null, 1800),
  c("building_type", "field", "levels.1.efficiencyBp", null, 1000),
  c("building_type", "field", "levels.1.inputSavingBp", null, 2500),
  c("building_type", "field", "levels.2.yieldBp", null, 3500),
  c("building_type", "field", "levels.2.efficiencyBp", null, 1000),
  c("building_type", "field", "levels.2.inputSavingBp", null, 1000),
  c("building_type", "field", "levels.2.qualityBonus", null, 1),
  c("building_type", "barn", "levels.0.upgradeCost", 9000000, 4500000),
  c("building_type", "barn", "levels.0.upgradeSteelKg", 4000, 2000),
  c("building_type", "barn", "qualityUpgradeCosts.0", 4000000, 7000000),
  c("building_type", "barn", "qualityUpgradeCosts.1", 12000000, 18000000),
  c("building_type", "barn", "levels.1.yieldBp", null, 1000),
  c("building_type", "barn", "levels.1.efficiencyBp", null, 500),
  c("building_type", "barn", "levels.1.inputSavingBp", null, 1500),
  c("building_type", "barn", "levels.2.yieldBp", null, 2000),
  c("building_type", "barn", "levels.2.efficiencyBp", null, 1000),
  c("building_type", "barn", "levels.2.inputSavingBp", null, 2500),
  c("building_type", "mine", "levels.0.upgradeCost", 10000000, 5000000),
  c("building_type", "mine", "levels.0.upgradeSteelKg", 5000, 2500),
  c("building_type", "mine", "qualityUpgradeCosts.0", 4000000, 6000000),
  c("building_type", "mine", "qualityUpgradeCosts.1", 12000000, 16000000),
  c("building_type", "mine", "levels.1.yieldBp", null, 1500),
  c("building_type", "mine", "levels.1.efficiencyBp", null, 1500),
  c("building_type", "mine", "levels.1.qualityBonus", null, 1),
  c("building_type", "mine", "levels.2.yieldBp", null, 3000),
  c("building_type", "mine", "levels.2.efficiencyBp", null, 2500),
  c("building_type", "mine", "levels.2.qualityBonus", null, 1),
  c("building_type", "food_plant", "levels.0.upgradeCost", 12000000, 6000000),
  c("building_type", "food_plant", "levels.0.upgradeSteelKg", 6000, 3000),
  c("building_type", "food_plant", "qualityUpgradeCosts.0", 5000000, 10000000),
  c("building_type", "food_plant", "qualityUpgradeCosts.1", 14000000, 24000000),
  c("building_type", "food_plant", "levels.1.yieldBp", null, 300),
  c("building_type", "food_plant", "levels.1.efficiencyBp", null, 700),
  c("building_type", "food_plant", "levels.1.inputSavingBp", null, 1000),
  c("building_type", "food_plant", "levels.2.yieldBp", null, 600),
  c("building_type", "food_plant", "levels.2.efficiencyBp", null, 1400),
  c("building_type", "food_plant", "levels.2.inputSavingBp", null, 1800),
  c("building_type", "steel_mill", "levels.0.upgradeCost", 13000000, 4000000),
  c("building_type", "steel_mill", "levels.0.upgradeSteelKg", 6000, 2000),
  c("building_type", "steel_mill", "qualityUpgradeCosts.0", 5000000, 10000000),
  c("building_type", "steel_mill", "qualityUpgradeCosts.1", 14000000, 24000000),
  c("building_type", "steel_mill", "levels.1.yieldBp", null, 300),
  c("building_type", "steel_mill", "levels.1.efficiencyBp", null, 600),
  c("building_type", "steel_mill", "levels.1.inputSavingBp", null, 800),
  c("building_type", "steel_mill", "levels.2.yieldBp", null, 600),
  c("building_type", "steel_mill", "levels.2.efficiencyBp", null, 1200),
  c("building_type", "steel_mill", "levels.2.inputSavingBp", null, 1600),
  c("research", "quality_control", "baseCost", 5000000, 10000000),
  ],
};

export const CATALOG_REVISIONS: CatalogRevision[] = [V3_2026_11, V3_2026_11B];

export interface RevisionReport {
  revisionId: string;
  applied: Array<{ kind: string; id: string; paths: string[] }>;
  skipped: Array<{ kind: string; id: string; path?: string; reason: "missing" | "edited" | "diverged" }>;
}

const META_PREFIX = "catalog.rev.";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur = root as Record<string, unknown>;
  for (const seg of segs.slice(0, -1)) cur = cur[seg] as Record<string, unknown>;
  cur[segs[segs.length - 1]!] = value;
}

/** `from === null`: yeni isteğe bağlı alan, yalnızca yol yoksa uygulanır */
function matchesFrom(root: unknown, path: string, from: unknown): boolean {
  const cur = getPath(root, path);
  return from === null ? cur === undefined : deepEqual(cur, from);
}

/** Yama yolları uygulanabilir mi: kök değer nesne ya da dizi ve yolun üst düğümü var olmalı */
function parentExists(root: unknown, path: string): boolean {
  const segs = path.split(".");
  return segs.length === 1 ? typeof root === "object" && root !== null : typeof getPath(root, segs.slice(0, -1).join(".")) === "object" && getPath(root, segs.slice(0, -1).join(".")) !== null;
}

export async function applyCatalogRevisions(db: Db, revisions: CatalogRevision[] = CATALOG_REVISIONS, now: Date = new Date()): Promise<RevisionReport[]> {
  const reports: RevisionReport[] = [];
  for (const rev of revisions) {
    const report = await db.transaction(async (tx): Promise<RevisionReport | null> => {
      // işaret önce yazılır: eşzamanlı ikinci çalıştırıcı bu satırda bekler, sonra "zaten uygulandı" görür
      const mark = await tx
        .insert(meta)
        .values({ key: `${META_PREFIX}${rev.id}`, value: { appliedAt: now.toISOString() } })
        .onConflictDoNothing()
        .returning({ key: meta.key });
      if (!mark[0]) return null;

      // önceki revizyonların satır başına bindirdiği sürüm sayısı
      const prior = await tx.select().from(meta).where(like(meta.key, `${META_PREFIX}%`));
      const bumps = new Map<string, number>();
      for (const r of prior) {
        const applied = (r.value as { applied?: Array<{ kind: string; id: string }> }).applied ?? [];
        for (const a of applied) if (a.kind !== "setting") bumps.set(`${a.kind}:${a.id}`, (bumps.get(`${a.kind}:${a.id}`) ?? 0) + 1);
      }

      const out: RevisionReport = { revisionId: rev.id, applied: [], skipped: [] };
      for (const ch of rev.changes) {
        if (ch.kind === "setting") {
          const row = (await tx.select().from(settings).where(eq(settings.key, ch.id)).for("update").limit(1))[0];
          if (!row) { out.skipped.push({ kind: ch.kind, id: ch.id, reason: "missing" }); continue; }
          const next = structuredClone(row.value) as Record<string, unknown>;
          const done: string[] = [];
          for (const p of ch.patch) {
            if (parentExists(next, p.path) && matchesFrom(next, p.path, p.from)) { setPath(next, p.path, p.to); done.push(p.path); }
            else out.skipped.push({ kind: ch.kind, id: ch.id, path: p.path, reason: "edited" });
          }
          if (done.length) {
            await tx.update(settings).set({ value: next, updatedAt: now }).where(eq(settings.key, ch.id));
            out.applied.push({ kind: ch.kind, id: ch.id, paths: done });
          }
          continue;
        }
        const row = (
          await tx.select().from(catalogItems).where(and(eq(catalogItems.kind, ch.kind), eq(catalogItems.id, ch.id))).for("update").limit(1)
        )[0];
        if (!row) { out.skipped.push({ kind: ch.kind, id: ch.id, reason: "missing" }); continue; }
        const key = `${ch.kind}:${ch.id}`;
        if (row.version !== 1 + (bumps.get(key) ?? 0)) { out.skipped.push({ kind: ch.kind, id: ch.id, reason: "edited" }); continue; }
        const before = row.data;
        const next = structuredClone(row.data) as Record<string, unknown>;
        const done: string[] = [];
        for (const p of ch.patch) {
          if (parentExists(next, p.path) && matchesFrom(next, p.path, p.from)) { setPath(next, p.path, p.to); done.push(p.path); }
          else out.skipped.push({ kind: ch.kind, id: ch.id, path: p.path, reason: "diverged" });
        }
        if (!done.length) continue;
        const version = row.version + 1;
        await tx.update(catalogItems).set({ data: next, version, updatedAt: now }).where(and(eq(catalogItems.kind, ch.kind), eq(catalogItems.id, ch.id)));
        await tx.insert(catalogHistory).values({ kind: ch.kind, itemId: ch.id, version, before, after: next, changedAt: now, changedBy: null, reasoning: `revizyon ${rev.id}` });
        bumps.set(key, (bumps.get(key) ?? 0) + 1);
        out.applied.push({ kind: ch.kind, id: ch.id, paths: done });
      }
      await tx
        .update(meta)
        .set({ value: { appliedAt: now.toISOString(), applied: out.applied, skipped: out.skipped }, updatedAt: sql`now()` })
        .where(eq(meta.key, `${META_PREFIX}${rev.id}`));
      return out;
    });
    if (report) reports.push(report);
  }
  return reports;
}
