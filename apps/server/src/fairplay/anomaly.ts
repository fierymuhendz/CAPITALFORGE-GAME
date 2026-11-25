/**
 * Fiyat sapması değerlendirmesi (hem tespit görevi hem inceleme ekranı kullanır).
 * Karşılaştırılabilirler: aynı ürün, aynı (teslim) şehir, işlemden önceki windowHours saatteki işlemler ve kabul
 * edilmiş sözleşme fiyatları; kalite 2'ye normalize. Aynı bağlantı grubundaki tarafların kendi aralarındaki
 * işlemleri, yeterli sayıda bağımsız karşılaştırma varsa referanstan dışlanır (ortak hareket referansı bozmasın).
 * Ters kayıtla düzeltilmiş işlemler referansa girmez.
 */
import { sql, type SQL } from "drizzle-orm";
import { priceAnomaly, qualityNormalized, type AnomalyResult } from "@capitalforge/economy";
import { QUALITY_PRICE_BP, type Settings } from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";

export interface AnomalySubject {
  productId: string;
  cityId: string;
  quality: number;
  pricePerKg: bigint;
  at: Date;
  sellerCompanyId: string;
  buyerCompanyId: string;
  excludeTradeId?: string;
  excludeContractId?: string;
}

export interface AnomalyEval extends AnomalyResult {
  sameConnectionGroup: boolean;
  priceQ2: bigint;
}

const HOUR = 3600_000;

/** İki şirketin hesapları ortak bir IP karmasını paylaşıyor mu (sütun adları sabit, kullanıcı girdisi değil) */
export const sameGroupExpr = (sellerCol: string, buyerCol: string): SQL => sql.raw(`EXISTS (
  SELECT 1 FROM cf.companies gcs
  JOIN cf.connection_records grs ON grs.account_id = gcs.account_id
  JOIN cf.companies gcb ON gcb.id = ${buyerCol}
  JOIN cf.connection_records grb ON grb.account_id = gcb.account_id AND grb.ip_hash = grs.ip_hash
  WHERE gcs.id = ${sellerCol} AND grs.account_id <> grb.account_id)`);

export async function sameGroup(db: DbOrTx, sellerCompanyId: string, buyerCompanyId: string): Promise<boolean> {
  if (sellerCompanyId === buyerCompanyId) return false;
  const rows = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM cf.companies gcs
      JOIN cf.connection_records grs ON grs.account_id = gcs.account_id
      JOIN cf.companies gcb ON gcb.id = ${buyerCompanyId}::uuid
      JOIN cf.connection_records grb ON grb.account_id = gcb.account_id AND grb.ip_hash = grs.ip_hash
      WHERE gcs.id = ${sellerCompanyId}::uuid AND grs.account_id <> grb.account_id)::text AS g`)) as unknown as Array<{ g: string }>;
  return rows[0]?.g === "true";
}

export async function evaluateAnomaly(db: DbOrTx, settings: Settings, s: AnomalySubject): Promise<AnomalyEval> {
  const { thresholdBp, minComparables, windowHours } = settings.anomaly;
  const from = new Date(s.at.getTime() - windowHours * HOUR).toISOString();
  const to = s.at.toISOString();
  const exT = s.excludeTradeId ?? null;
  const exC = s.excludeContractId ?? null;
  const rows = (await db.execute(sql`
    SELECT x.price::text AS price, x.q::text AS q, x.grp::text AS grp FROM (
      SELECT t.price_per_kg AS price, t.quality AS q, ${sameGroupExpr("t.seller_company_id", "t.buyer_company_id")} AS grp
      FROM cf.trades t
      WHERE t.product_id = ${s.productId} AND t.city_id = ${s.cityId}
        AND t.created_at > ${from}::timestamptz AND t.created_at <= ${to}::timestamptz
        AND t.id IS DISTINCT FROM ${exT}::uuid
        AND NOT EXISTS (SELECT 1 FROM cf.ledger_transactions r WHERE r.reverses_id = t.transaction_id)
      UNION ALL
      SELECT k.price_per_kg AS price, k.min_quality AS q, ${sameGroupExpr("k.seller_company_id", "k.buyer_company_id")} AS grp
      FROM cf.contracts k
      WHERE k.product_id = ${s.productId} AND k.delivery_city_id = ${s.cityId}
        AND k.status IN ('active', 'completed') AND k.is_system = false
        AND k.accepted_at > ${from}::timestamptz AND k.accepted_at <= ${to}::timestamptz
        AND k.id IS DISTINCT FROM ${exC}::uuid
    ) x`)) as unknown as Array<{ price: string; q: string; grp: string }>;

  const norm = rows.map((r) => ({ p: qualityNormalized(BigInt(r.price), Number(r.q), QUALITY_PRICE_BP), grp: r.grp === "true" }));
  const independent = norm.filter((r) => !r.grp);
  const used = independent.length >= minComparables ? independent : norm;
  const priceQ2 = qualityNormalized(s.pricePerKg, s.quality, QUALITY_PRICE_BP);
  const res = priceAnomaly(priceQ2, used.map((r) => r.p), thresholdBp, minComparables);
  return { ...res, sameConnectionGroup: await sameGroup(db, s.sellerCompanyId, s.buyerCompanyId), priceQ2 };
}
