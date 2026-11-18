/**
 * Migration çalıştırıcı (üretim ve CI). drizzle-kit migrate hata ayrıntısını yutuyor;
 * bu betik aynı drizzle.__drizzle_migrations tablosunu kullanır ve hatayı açıkça yazar.
 * Veritabanı henüz bağlantı kabul etmiyorsa birkaç kez yeniden dener.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil");
  process.exit(1);
}
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function main(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const client = postgres(url!, { max: 1, onnotice: () => {} });
    try {
      await client`select 1`;
      await migrate(drizzle(client), { migrationsFolder });
      console.log("Migration'lar uygulandı");
      await client.end();
      return;
    } catch (err) {
      await client.end({ timeout: 1 }).catch(() => {});
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

await main();
