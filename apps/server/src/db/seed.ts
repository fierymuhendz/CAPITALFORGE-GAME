/**
 * Dünya tohumlaması: idempotent. Yalnızca eksik satırları ekler, var olanı EZMEZ
 * (yönetici düzenlemeleri ve oyuncu verisi korunur). Her açılışta güvenle çalışır.
 */
import { sql } from "drizzle-orm";
import {
  BUILDING_TYPES, CITIES, DEFAULT_SETTINGS, PLOTS, PRODUCTS, RECIPES, RESEARCH, SYSTEM_CARRIER, SYSTEM_PROFILES, VEHICLE_MODELS,
} from "@capitalforge/shared";
import { refPrice } from "@capitalforge/economy";
import type { Db } from "./client";
import { catalogItems, companies, meta, plots, priceRefs, settings, worldClock } from "./schema";
import { COMPANY_ACCOUNTS } from "../ledger/accounts";
import { ledgerAccounts } from "./schema";
import { co, post } from "../ledger/post";

/** Sistem şirketlerine bir kez verilen işletme sermayesi (kuruş) */
export const SYSTEM_COMPANY_CAPITAL = 2_000_000_000n; // ₺20 milyon

export async function seedWorld(db: Db): Promise<void> {
  const items: Array<{ kind: "city" | "product" | "building_type" | "recipe" | "research" | "vehicle_model"; id: string; data: unknown }> = [
    ...CITIES.map((d) => ({ kind: "city" as const, id: d.id, data: d })),
    ...PRODUCTS.map((d) => ({ kind: "product" as const, id: d.id, data: d })),
    ...BUILDING_TYPES.map((d) => ({ kind: "building_type" as const, id: d.id, data: d })),
    ...RECIPES.map((d) => ({ kind: "recipe" as const, id: d.id, data: d })),
    ...RESEARCH.map((d) => ({ kind: "research" as const, id: d.id, data: d })),
    ...VEHICLE_MODELS.map((d) => ({ kind: "vehicle_model" as const, id: d.id, data: d })),
  ];
  await db.insert(catalogItems).values(items.map((i) => ({ ...i, data: i.data as object }))).onConflictDoNothing();
  await db
    .insert(settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value: value as object })))
    .onConflictDoNothing();
  await db
    .insert(plots)
    .values(
      PLOTS.map((p) => ({
        id: p.id, cityId: p.cityId, gx: p.gx, gz: p.gz, price: BigInt(p.price), minLevel: p.minLevel, sizeHa: p.sizeHa,
        fertilityBp: p.fertilityBp, pastureBp: p.pastureBp, depositKind: p.deposit?.kind ?? null,
        depositRichnessBp: p.deposit?.richnessBp ?? null, distanceToCenterKm: p.distanceToCenterKm,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(priceRefs)
    .values(
      PRODUCTS.flatMap((p) =>
        CITIES.map((c) => ({ productId: p.id, cityId: c.id, driftBp: 10000, refPricePerKg: refPrice(p.basePricePerKg, c.priceBp[p.id] ?? 10000, 10000) })),
      ),
    )
    .onConflictDoNothing();
  await db.insert(worldClock).values({ id: 1, offsetMs: 0 }).onConflictDoNothing();
  await db.insert(meta).values({ key: "world", value: { createdAt: new Date().toISOString(), version: 2 } }).onConflictDoNothing();

  // Sistem şirketleri
  const sys = [
    ...SYSTEM_PROFILES.map((p) => ({ key: p.companyKey, name: p.name.tr, city: p.cityId, sector: (p.companyKey.startsWith("construction") || p.companyKey.startsWith("power") ? "manufacturing" : "crop") as "manufacturing" | "crop" })),
    { key: SYSTEM_CARRIER.companyKey, name: SYSTEM_CARRIER.name.tr, city: "kavsak", sector: "freight" as const },
    { key: "bank", name: "Forge Bankası", city: "korfezkent", sector: "manufacturing" as const },
  ];
  for (const s of sys) {
    await db
      .insert(companies)
      .values({ name: s.name, nameLower: s.name.toLowerCase(), sector: s.sector, homeCityId: s.city, isSystem: true, systemKey: s.key, nextUpkeepAt: new Date("2100-01-01T00:00:00Z") })
      .onConflictDoNothing();
  }
  // Hesap planı (eksik hesaplar) + sistem sermayesi (bir kez)
  const sysCos = await db.select({ id: companies.id, key: companies.systemKey }).from(companies).where(sql`${companies.isSystem} = true`);
  for (const c of sysCos) {
    await ensureCompanyAccounts(db, c.id);
    await db.transaction((tx) =>
      post(tx, {
        kind: "system_capital",
        idempotencyKey: `system_capital:${c.id}`,
        refType: "company",
        refId: c.id,
        memo: "Sistem şirketi sermayesi",
        at: new Date(),
        lines: [
          { account: co(c.id, "cash"), amount: SYSTEM_COMPANY_CAPITAL },
          { account: co(c.id, "equity"), amount: -SYSTEM_COMPANY_CAPITAL },
        ],
      }),
    );
  }
}

export async function ensureCompanyAccounts(db: Pick<Db, "insert">, companyId: string): Promise<void> {
  await db
    .insert(ledgerAccounts)
    .values(Object.entries(COMPANY_ACCOUNTS).map(([code, kind]) => ({ companyId, code, kind })))
    .onConflictDoNothing();
}
