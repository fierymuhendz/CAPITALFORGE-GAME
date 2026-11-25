/**
 * Muhasebe değişmezleri (testlerde her senaryo sonunda çağrılır):
 * 1) defter toplamı 0 ve her işlem dengeli
 * 2) önbellekli bakiyeler = satır toplamları
 * 3) şirket nakdi ≥ 0
 * 4) şirketin stok hesabı = depo maliyetleri + yoldaki kendi yükünün maliyeti
 */
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

export async function checkInvariants(db: Db): Promise<string[]> {
  const problems: string[] = [];
  const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Array<Record<string, unknown>>;
  const total = await q(sql`SELECT coalesce(sum(amount),0)::text AS s FROM cf.ledger_entries`);
  if (total[0]!.s !== "0") problems.push(`defter toplamı ${total[0]!.s}`);
  const unbalanced = await q(sql`SELECT transaction_id FROM cf.ledger_entries GROUP BY transaction_id HAVING sum(amount) <> 0 LIMIT 5`);
  if (unbalanced.length) problems.push(`dengesiz işlem: ${unbalanced.map((r) => r.transaction_id).join(",")}`);
  const cache = await q(sql`
    SELECT a.id, a.code, a.balance::text b, coalesce(sum(e.amount),0)::text s
    FROM cf.ledger_accounts a LEFT JOIN cf.ledger_entries e ON e.account_id = a.id
    GROUP BY a.id HAVING a.balance <> coalesce(sum(e.amount),0) LIMIT 5`);
  if (cache.length) problems.push(`önbellek bakiyesi uyuşmuyor: ${JSON.stringify(cache)}`);
  const neg = await q(sql`SELECT company_id FROM cf.ledger_accounts WHERE company_id IS NOT NULL AND code='cash' AND balance < 0`);
  if (neg.length) problems.push(`negatif nakit: ${neg.map((r) => r.company_id).join(",")}`);
  const inv = await q(sql`
    WITH h AS (SELECT company_id, sum(cost_total) c FROM cf.holdings GROUP BY company_id),
    t AS (SELECT sc.owner_company_id company_id, sum(sc.cost_basis) c FROM cf.shipment_cargo sc
          JOIN cf.shipments s ON s.id = sc.shipment_id WHERE s.status = 'in_transit' GROUP BY sc.owner_company_id),
    l AS (SELECT company_id, balance c FROM cf.ledger_accounts WHERE code = 'inventory' AND company_id IS NOT NULL)
    SELECT l.company_id, l.c::text ledger, (coalesce(h.c,0) + coalesce(t.c,0))::text stock
    FROM l LEFT JOIN h ON h.company_id = l.company_id LEFT JOIN t ON t.company_id = l.company_id
    WHERE l.c <> coalesce(h.c,0) + coalesce(t.c,0) LIMIT 5`);
  if (inv.length) problems.push(`stok hesabı ≠ depo: ${JSON.stringify(inv)}`);
  return problems;
}
