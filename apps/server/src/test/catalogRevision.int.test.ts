import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { applyCatalogRevisions, CATALOG_REVISIONS, type CatalogRevision } from "../db/catalogRevision";
import { catalogHistory, catalogItems, meta, settings } from "../db/schema";
import { createHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const recipe = async (id: string) => (await h.deps.db.select().from(catalogItems).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, id))))[0]!;

describe("katalog revizyonu", () => {
  it("yalnızca düzenlenmemiş satırı günceller; bir kez uygulanır; zincirleme revizyon sürümü izler", async () => {
    const db = h.deps.db;
    const a = await recipe("grow_fodder");
    const b = await recipe("mill_flour");
    const aMin = (a.data as { minutes: number }).minutes;
    const bMin = (b.data as { minutes: number }).minutes;
    // yönetici düzenlemesi: sürüm 2
    await db.update(catalogItems).set({ version: 2, data: { ...(b.data as object), minutes: bMin + 5 } }).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, "mill_flour")));
    const [fee] = await db.select().from(settings).where(eq(settings.key, "freight"));
    const f = fee!.value as { systemPickupAfterMinutes: number };
    const rev1: CatalogRevision = {
      id: "t1",
      changes: [
        { kind: "recipe", id: "grow_fodder", patch: [{ path: "minutes", from: aMin, to: aMin + 100 }] },
        { kind: "recipe", id: "mill_flour", patch: [{ path: "minutes", from: bMin, to: bMin + 100 }] },
        { kind: "recipe", id: "grow_grain", patch: [{ path: "minutes", from: -1, to: 5 }] },
        { kind: "setting", id: "freight", patch: [{ path: "systemPickupAfterMinutes", from: f.systemPickupAfterMinutes, to: f.systemPickupAfterMinutes + 7 }] },
        { kind: "setting", id: "marketFeeBp", patch: [{ path: "x", from: 1, to: 2 }] },
      ],
    };
    const r1 = await applyCatalogRevisions(db, [rev1]);
    expect(r1[0]!.applied.map((x) => x.id).sort()).toEqual(["freight", "grow_fodder"]);
    expect(r1[0]!.skipped.map((x) => `${x.id}:${x.reason}`)).toEqual(expect.arrayContaining(["mill_flour:edited", "grow_grain:diverged"]));
    expect(await recipe("grow_fodder")).toMatchObject({ version: 2, data: expect.objectContaining({ minutes: aMin + 100 }) });
    expect((await recipe("mill_flour")).data).toMatchObject({ minutes: bMin + 5 });
    expect((await db.select().from(catalogHistory).where(eq(catalogHistory.itemId, "grow_fodder"))).length).toBe(1);
    const [fee2] = await db.select().from(settings).where(eq(settings.key, "freight"));
    expect((fee2!.value as { systemPickupAfterMinutes: number }).systemPickupAfterMinutes).toBe(f.systemPickupAfterMinutes + 7);
    expect((await db.select().from(meta).where(eq(meta.key, "catalog.rev.t1"))).length).toBe(1);

    // ikinci çalıştırma: hiçbir şey olmaz
    expect(await applyCatalogRevisions(db, [rev1])).toEqual([]);
    expect((await recipe("grow_fodder")).version).toBe(2);

    // zincirleme: revizyonun kendi bindirdiği sürüm "düzenleme" sayılmaz; yönetici satırı yine atlanır
    const rev2: CatalogRevision = { id: "t2", changes: [
      { kind: "recipe", id: "grow_fodder", patch: [{ path: "minutes", from: aMin + 100, to: aMin + 200 }] },
      { kind: "recipe", id: "mill_flour", patch: [{ path: "minutes", from: bMin + 5, to: bMin + 200 }] },
    ] };
    const r2 = await applyCatalogRevisions(db, [rev2]);
    expect(r2[0]!.applied.map((x) => x.id)).toEqual(["grow_fodder"]);
    expect((await recipe("grow_fodder")).version).toBe(3);
    expect((await recipe("mill_flour")).data).toMatchObject({ minutes: bMin + 5 });
    // temizlik
    await db.update(catalogItems).set({ version: 1, data: a.data as object }).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, "grow_fodder")));
    await db.update(catalogItems).set({ version: 1, data: b.data as object }).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, "mill_flour")));
    await db.update(settings).set({ value: fee!.value as object }).where(eq(settings.key, "freight"));
  });

  it("gönderilen v3 revizyonu taze veritabanında (değerler zaten yeni) hiçbir satırı bozmaz ve tekrar uygulanmaz", async () => {
    const before = await h.deps.db.select().from(catalogItems);
    expect(CATALOG_REVISIONS[0]!.id).toBe("v3-2026-11");
    expect(await applyCatalogRevisions(h.deps.db)).toEqual([]); // migrate sırasında işaretlendi
    expect(await h.deps.db.select().from(catalogItems)).toEqual(before);
  });
});
