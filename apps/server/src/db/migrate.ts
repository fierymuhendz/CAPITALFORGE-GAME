/**
 * Migration çalıştırıcı (üretim, CI, test). Migration geçmişi cf_migrations şemasında tutulur;
 * eski oyunun drizzle.__drizzle_migrations tablosuna dokunulmaz. Bağlantı yoksa yeniden dener.
 * Migration sonrası katalog/arsa/sistem şirketi tohumlaması yapılır (yalnızca eksik satırlar).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import { applyCatalogRevisions } from "./catalogRevision";
import { seedWorld } from "./seed";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {}, types: { bigint: postgres.BigInt } });
  try {
    await client`select 1`;
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder, migrationsSchema: "cf_migrations", migrationsTable: "migrations" });
    await seedWorld(db);
    await applyCatalogRevisions(db);
  } finally {
    await client.end({ timeout: 2 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL tanımlı değil");
    process.exit(1);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await runMigrations(url);
      console.log("Migration'lar ve tohumlama tamam");
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const connErr = code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "57P03" || code === "EAI_AGAIN";
      if (connErr && attempt < 10) {
        console.warn(`Veritabanına bağlanılamadı (${code}), ${attempt}. deneme; 3 sn sonra yeniden`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      console.error("Migration başarısız:", err);
      process.exit(1);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
