import { PARAMS, PRODUCT_IDS, initialPool } from "@capitalforge/economy";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { createRedis, type Redis } from "../redis";

/**
 * Integration testleri için veritabanı yardımcısı.
 * Güvenlik: yalnızca adı "test" içeren veritabanında ve 0 dışında bir Redis db indeksinde çalışır;
 * geliştirme verisini yanlışlıkla TRUNCATE/FLUSHDB etmemek için.
 */

const PRODUCT_NAMES = { wheat: "Buğday", iron: "Demir", energy: "Enerji", flour: "Un", steel: "Çelik" } as const;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

const pathName = (url: string): string => new URL(url).pathname.replace(/^\//, "");

let client: ReturnType<typeof postgres> | undefined;
let testDb: Db | undefined;
let testRedis: Redis | undefined;

/** DATABASE_URL'e bağlanır, migration'ları uygular ve tekil bir Db döner. */
export async function setupTestDb(): Promise<Db> {
  if (testDb) return testDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil; integration testleri için test veritabanı gerekir");
  const name = pathName(url);
  if (!/test/i.test(name)) {
    throw new Error(`Integration testleri yalnızca adı 'test' içeren veritabanında çalışır, bulunan: '${name}'`);
  }
  client = postgres(url, { max: 10, onnotice: () => undefined });
  testDb = drizzle(client, { schema });
  await migrate(testDb, { migrationsFolder: MIGRATIONS_DIR });
  return testDb;
}

/** REDIS_URL'in db indeksi 0 olmayan bir test indeksi olmalı. Tekil bağlantı döner. */
export function setupTestRedis(): Redis {
  if (testRedis) return testRedis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL tanımlı değil; integration testleri için test Redis'i gerekir");
  const index = pathName(url);
  if (!/^[1-9]\d*$/.test(index)) {
    throw new Error(`Redis test indeksi 0 olmayan bir db indeksi olmalı (ör. redis://host:6379/1), bulunan: '${index}'`);
  }
  testRedis = createRedis();
  return testRedis;
}

/**
 * Tüm oyuncu/ticaret/defter verisini siler. Sistem hesapları, oyun saati ve ürün seed'i (migration 0001/0002 ile aynı)
 * yeniden yazılır; ürün fiyatları seed değerine döner, tick 0 olur.
 */
export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE relief_claims, player_actions, production_jobs, facilities, companies, ledger_entries, transfers, trades, price_history, inventories, accounts, players RESTART IDENTITY CASCADE`,
  );
  await db.execute(
    sql`INSERT INTO accounts (kind, code) VALUES ('system', 'system:mint'), ('system', 'system:tax'), ('system', 'system:market'), ('system', 'system:fees')`,
  );
  await db.execute(sql`INSERT INTO game_clock (id, tick) VALUES (1, 0) ON CONFLICT (id) DO UPDATE SET tick = 0`);
  for (const id of PRODUCT_IDS) {
    const pool = initialPool(id);
    await db.execute(
      sql`INSERT INTO products (id, name, price, pool_units, pool_value, tick)
          VALUES (${id}, ${PRODUCT_NAMES[id]}, ${PARAMS.initialPrice[id]}, ${pool.units}, ${pool.value}, 0)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price,
            pool_units = EXCLUDED.pool_units, pool_value = EXCLUDED.pool_value, tick = 0`,
    );
  }
  await db.execute(sql`INSERT INTO price_history (product_id, tick, price) SELECT id, 0, price FROM products`);
}

/**
 * Defter invariantları:
 * - Her transfer için bacakların toplamı 0.
 * - Oyuncu hesaplarında balance = ledger_entries toplamı.
 * - Tüm defterin toplamı 0.
 * Bozuksa hata fırlatır.
 */
export async function assertLedgerBalanced(db: Db): Promise<void> {
  const unbalanced = await db.execute<{ transfer_id: string; total: string }>(
    sql`SELECT transfer_id, SUM(amount)::text AS total FROM ledger_entries GROUP BY transfer_id HAVING SUM(amount) <> 0`,
  );
  if (unbalanced.length > 0) {
    throw new Error(`Defter dengesiz transfer(ler): ${JSON.stringify(unbalanced.slice(0, 5))}`);
  }

  const mismatched = await db.execute<{ id: string; balance: string; derived: string }>(
    sql`SELECT a.id, a.balance::text AS balance, COALESCE(SUM(e.amount), 0)::text AS derived
        FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.kind = 'player' GROUP BY a.id HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
  );
  if (mismatched.length > 0) {
    throw new Error(`Oyuncu bakiyesi defterle uyuşmuyor: ${JSON.stringify(mismatched.slice(0, 5))}`);
  }

  const [total] = await db.execute<{ total: string }>(
    sql`SELECT COALESCE(SUM(amount), 0)::text AS total FROM ledger_entries`,
  );
  if (total?.total !== "0") throw new Error(`Defter toplamı sıfır değil: ${total?.total}`);
}

/** Bağlantıları kapatır. Her integration test dosyasının afterAll'ında çağrılır. */
export async function closeTestResources(): Promise<void> {
  if (testRedis) {
    testRedis.disconnect();
    testRedis = undefined;
  }
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    testDb = undefined;
  }
}
