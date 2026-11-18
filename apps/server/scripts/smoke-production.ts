/**
 * Duman testi: şirket kur → tesis al → üretim başlat → tick'lerle tamamlan → sat.
 * Kullanım: DATABASE_URL=... pnpm exec tsx scripts/smoke-production.ts
 * Geliştirme veritabanına bir misafir oyuncu ekler (silmez).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createGuest } from "../src/auth/guest";
import { buyFacility } from "../src/company/buyFacility";
import { foundCompany } from "../src/company/found";
import { getCompanyView } from "../src/company/view";
import { createDb } from "../src/db/client";
import { runTickCycle } from "../src/market/ticker";
import { executeTrade } from "../src/market/trade";
import { getPortfolio } from "../src/market/portfolio";
import { startProduction } from "../src/production/start";
import { claimRelief } from "../src/relief/claim";

const db = createDb();
const guest = await createGuest(db, `smoke_${Date.now().toString(36)}`);
if (!guest.ok) throw new Error("misafir oluşturulamadı");
const pid = guest.playerId;
const key = () => randomUUID();
const show = (label: string, v: unknown) => console.log(label, JSON.stringify(v));

show("relief (şirketsiz, zengin) beklenen NOT_ELIGIBLE", await claimRelief(db, pid, { idempotencyKey: key() }));
const fk = key();
const c1 = await foundCompany(db, pid, { name: `Smoke ${Date.now()}`, idempotencyKey: fk });
show("kuruluş", c1);
show("kuruluş tekrar (duplicate)", await foundCompany(db, pid, { name: (await getCompanyView(db, pid)).company!.name, idempotencyKey: fk }));
const plant = await buyFacility(db, pid, { type: "power_plant", plotX: Math.floor(Math.random() * 16), plotY: Math.floor(Math.random() * 16), idempotencyKey: key() });
show("santral", plant);
if (!plant.ok) throw new Error("santral alınamadı");
const job = await startProduction(db, pid, { facilityId: plant.refId!, recipeId: "generate_energy", batches: 3, idempotencyKey: key() });
show("üretim", job);
show("meşgul tesis", await startProduction(db, pid, { facilityId: plant.refId!, recipeId: "generate_energy", batches: 1, idempotencyKey: key() }));

let completedAt: number | undefined;
for (let i = 0; i < 70 && completedAt === undefined; i++) {
  const r = await runTickCycle(db);
  if (r.completed.some((j) => j.playerId === pid)) completedAt = r.broadcast.clockTick;
}
show("tamamlandı, clockTick", completedAt);
show("envanter", await getPortfolio(db, pid));
const sell = await executeTrade(db, pid, { side: "sell", productId: "energy", quantity: 60, idempotencyKey: key() });
show("satış", sell);
const view = await getCompanyView(db, pid);
show("görünüm", { jobs: view.jobs.length, facilities: view.facilities.length, clockTick: view.clockTick, relief: view.reliefAvailable });

const [bad] = await db.execute<{ total: string }>(sql`SELECT COALESCE(SUM(amount),0)::text AS total FROM ledger_entries`);
const mism = await db.execute(sql`SELECT a.id FROM accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.kind='player' GROUP BY a.id HAVING a.balance <> COALESCE(SUM(e.amount),0)`);
console.log("defter toplamı:", bad?.total, "| uyuşmayan bakiye:", mism.length);
process.exit(0);
