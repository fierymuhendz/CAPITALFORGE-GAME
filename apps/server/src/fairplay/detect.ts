/**
 * Adil oyun tespit görevleri. Hepsi uyarı (alerts) yazar; hiçbir otomatik yaptırım uygulamaz.
 * Uyarılar dedupe_key ile tekrar yazılmaz.
 */
import { and, eq, gt, isNotNull, lt, lte, sql } from "drizzle-orm";
import { growthBp, systemCarrierQuote } from "@capitalforge/economy";
import type { Deps } from "../deps";
import { connectionRecords, contracts, freightJobs, meta, trades } from "../db/schema";
import { m } from "../lib/serialize";
import { registerTask } from "../scheduler/scheduler";
import { evaluateAnomaly, sameGroup } from "./anomaly";
import { raiseAlert } from "./alerts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** işlem zamanı sırası/commit gecikmesi için imleç örtüşmesi (dedupe_key tekrarı engeller) */
const CURSOR_OVERLAP_MS = 5 * 60_000;
const BATCH = 500;

export const SHORTAGE_HOURS = 6;
export const UNFILLED_FREIGHT_HOURS = 2;
/** stok fazlası: stok > 7 günlük hacim × 3 ve en az bu kadar kg (gürültüyü azaltır) */
export const EXCESS_FACTOR = 3;
export const EXCESS_MIN_KG = 10_000;
/** servet sıçraması: 24 saatte +%300 ve en az ₺200.000 (kuruş) */
export const WEALTH_SPIKE_BP = 30_000;
export const WEALTH_SPIKE_MIN = 20_000_000n;
/** fiyat sıçraması: referans 24 saatte ±%40 */
export const PRICE_SPIKE_BP = 4000;

type Rows = Array<Record<string, string | null>>;
const run = async (deps: Deps, q: ReturnType<typeof sql>): Promise<Rows> => (await deps.db.execute(q)) as unknown as Rows;
const iso = (d: Date) => d.toISOString();
const dayKey = (d: Date) => iso(d).slice(0, 10);

async function getCursor(deps: Deps, key: string): Promise<Date | null> {
  const r = await deps.db.select().from(meta).where(eq(meta.key, key)).limit(1);
  const at = (r[0]?.value as { at?: string } | undefined)?.at;
  return at ? new Date(at) : null;
}
async function setCursor(deps: Deps, key: string, at: Date, now: Date): Promise<void> {
  await deps.db
    .insert(meta)
    .values({ key, value: { at: iso(at) }, updatedAt: now })
    .onConflictDoUpdate({ target: meta.key, set: { value: { at: iso(at) }, updatedAt: now } });
}

/** Yeni işlemler ve kabul edilen sözleşmeler için fiyat sapması. Döndürür: yazılan uyarı sayısı. */
export async function scanPriceAnomalies(deps: Deps, now: Date): Promise<number> {
  const s = deps.catalog.settings;
  let raised = 0;
  const fallback = new Date(now.getTime() - s.anomaly.windowHours * HOUR);

  // --- anlık işlemler ---
  const tKey = "fairplay.cursor.trades";
  let tFrom = new Date(((await getCursor(deps, tKey)) ?? fallback).getTime() - CURSOR_OVERLAP_MS);
  for (let loop = 0; loop < 20; loop++) {
    const rows = await deps.db
      .select()
      .from(trades)
      .where(and(gt(trades.createdAt, tFrom), lte(trades.createdAt, now)))
      .orderBy(trades.createdAt, trades.id)
      .limit(BATCH);
    for (const t of rows) {
      if (t.buyerIsSystem || t.sellerIsSystem) continue;
      const ev = await evaluateAnomaly(deps.db, s, {
        productId: t.productId, cityId: t.cityId, quality: t.quality, pricePerKg: t.pricePerKg, at: t.createdAt,
        sellerCompanyId: t.sellerCompanyId, buyerCompanyId: t.buyerCompanyId, excludeTradeId: t.id,
      });
      if (!ev.flagged || ev.refPricePerKg === null || ev.deviationBp === null) continue;
      const abs = Math.abs(ev.deviationBp);
      const ok = await raiseAlert(deps.db, {
        kind: "price_anomaly",
        severity: ev.insufficientData ? "info" : ev.sameConnectionGroup || abs >= 2 * s.anomaly.thresholdBp ? "high" : "warn",
        productId: t.productId, cityId: t.cityId, companyIds: [t.sellerCompanyId, t.buyerCompanyId],
        details: {
          refPricePerKg: m(ev.refPricePerKg), deviationBp: ev.deviationBp, comparables: ev.comparables, insufficientData: ev.insufficientData,
          sellerCompanyId: t.sellerCompanyId, buyerCompanyId: t.buyerCompanyId, sameConnectionGroup: ev.sameConnectionGroup,
          tradeId: t.id, pricePerKg: m(t.pricePerKg), quality: t.quality, qtyKg: t.qtyKg,
        },
        dedupeKey: `price_anomaly:trade:${t.id}`, at: now,
      });
      if (ok) raised++;
    }
    if (rows.length === 0) break;
    const last = rows[rows.length - 1]!.createdAt;
    await setCursor(deps, tKey, last, now);
    if (rows.length < BATCH) break;
    tFrom = last;
  }

  // --- kabul edilen sözleşmeler ---
  const cKey = "fairplay.cursor.contracts";
  let cFrom = new Date(((await getCursor(deps, cKey)) ?? fallback).getTime() - CURSOR_OVERLAP_MS);
  for (let loop = 0; loop < 20; loop++) {
    const rows = await deps.db
      .select()
      .from(contracts)
      .where(and(gt(contracts.acceptedAt, cFrom), lte(contracts.acceptedAt, now), eq(contracts.isSystem, false)))
      .orderBy(contracts.acceptedAt, contracts.id)
      .limit(BATCH);
    for (const k of rows) {
      if (!k.sellerCompanyId || !k.buyerCompanyId || !k.acceptedAt) continue;
      const ev = await evaluateAnomaly(deps.db, s, {
        productId: k.productId, cityId: k.deliveryCityId, quality: k.minQuality, pricePerKg: k.pricePerKg, at: k.acceptedAt,
        sellerCompanyId: k.sellerCompanyId, buyerCompanyId: k.buyerCompanyId, excludeContractId: k.id,
      });
      if (!ev.flagged || ev.refPricePerKg === null || ev.deviationBp === null) continue;
      const abs = Math.abs(ev.deviationBp);
      const ok = await raiseAlert(deps.db, {
        kind: "price_anomaly",
        severity: ev.insufficientData ? "info" : ev.sameConnectionGroup || abs >= 2 * s.anomaly.thresholdBp ? "high" : "warn",
        productId: k.productId, cityId: k.deliveryCityId, companyIds: [k.sellerCompanyId, k.buyerCompanyId],
        details: {
          refPricePerKg: m(ev.refPricePerKg), deviationBp: ev.deviationBp, comparables: ev.comparables, insufficientData: ev.insufficientData,
          sellerCompanyId: k.sellerCompanyId, buyerCompanyId: k.buyerCompanyId, sameConnectionGroup: ev.sameConnectionGroup,
          contractId: k.id, pricePerKg: m(k.pricePerKg), quality: k.minQuality, qtyKg: k.qtyPerInstallmentKg * k.installments,
        },
        dedupeKey: `price_anomaly:contract:${k.id}`, at: now,
      });
      if (ok) raised++;
    }
    if (rows.length === 0) break;
    const last = rows[rows.length - 1]!.acceptedAt!;
    await setCursor(deps, cKey, last, now);
    if (rows.length < BATCH) break;
    cFrom = last;
  }

  // --- taşıma ilanları: aynı bağlantı grubundaki şirketler arasındaki ilan ücreti (değer aktarımı kanalı) ---
  const fKey = "fairplay.cursor.freight";
  let fFrom = new Date(((await getCursor(deps, fKey)) ?? fallback).getTime() - CURSOR_OVERLAP_MS);
  const fq = s.freight;
  for (let loop = 0; loop < 20; loop++) {
    const rows = await deps.db
      .select()
      .from(freightJobs)
      .where(and(gt(freightJobs.acceptedAt, fFrom), lte(freightJobs.acceptedAt, now), eq(freightJobs.isSystem, false), isNotNull(freightJobs.carrierCompanyId)))
      .orderBy(freightJobs.acceptedAt, freightJobs.id)
      .limit(BATCH);
    for (const j of rows) {
      const carrierId = j.carrierCompanyId!;
      if (!(await sameGroup(deps.db, carrierId, j.shipperCompanyId))) continue;
      const quote = systemCarrierQuote(j.distanceKm, j.totalKg, fq.systemBaseFee, fq.systemPerKm);
      const devBp = quote > 0n ? Number(((j.payAmount - quote) * 10000n) / quote) : 0;
      const ok = await raiseAlert(deps.db, {
        kind: "price_anomaly", severity: "high", cityId: j.originCityId, companyIds: [carrierId, j.shipperCompanyId],
        details: {
          explanation: "Aynı bağlantı grubundaki şirketler arasında taşıma ilanı: ücret değer aktarımı için kullanılıyor olabilir",
          freightJobId: j.id, payAmount: m(j.payAmount), systemQuote: m(quote), refPricePerKg: m(quote), deviationBp: devBp, comparables: 0, insufficientData: false,
          sellerCompanyId: carrierId, buyerCompanyId: j.shipperCompanyId, sameConnectionGroup: true,
        },
        dedupeKey: `price_anomaly:freight:${j.id}`, at: now,
      });
      if (ok) raised++;
    }
    if (rows.length === 0) break;
    const last = rows[rows.length - 1]!.acceptedAt!;
    await setCursor(deps, fKey, last, now);
    if (rows.length < BATCH) break;
    fFrom = last;
  }
  return raised;
}

/** Kıtlık, stok fazlası, servet/fiyat sıçraması, taşımacısız iş, girdi eksikliğinden duran hat. */
export async function scanMarketWatch(deps: Deps, now: Date): Promise<number> {
  let raised = 0;
  const at = iso(now);
  const day = dayKey(now);
  const ago = (ms: number) => iso(new Date(now.getTime() - ms));

  // Kıtlık: açık alım emri var (6 saattir), hiç açık ilan yok
  const short = await run(deps, sql`
    SELECT o.product_id, o.city_id, string_agg(DISTINCT o.company_id::text, ',') AS cos, sum(o.remaining_kg)::text AS kg
    FROM cf.market_orders o
    WHERE o.side = 'buy' AND o.status = 'open' AND o.is_system = false AND o.remaining_kg > 0
      AND o.created_at <= ${ago(SHORTAGE_HOURS * HOUR)}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM cf.market_orders s WHERE s.side = 'sell' AND s.status = 'open' AND s.remaining_kg > 0
                      AND s.product_id = o.product_id AND s.city_id = o.city_id)
    GROUP BY o.product_id, o.city_id`);
  for (const r of short) {
    if (await raiseAlert(deps.db, {
      kind: "shortage", severity: "warn", productId: r.product_id, cityId: r.city_id, companyIds: (r.cos ?? "").split(",").slice(0, 10),
      details: { openOrderKg: Number(r.kg), hours: SHORTAGE_HOURS }, dedupeKey: `shortage:${r.product_id}:${r.city_id}:${day}`, at: now,
    })) raised++;
  }

  // Stok fazlası: oyuncu stoku > 7 günlük hacim × 3
  const excess = await run(deps, sql`
    WITH s AS (
      SELECT h.product_id, h.city_id, sum(h.qty_kg) AS kg FROM cf.holdings h JOIN cf.companies c ON c.id = h.company_id
      WHERE c.is_system = false GROUP BY h.product_id, h.city_id),
    v AS (
      SELECT product_id, city_id, sum(qty_kg) AS kg FROM cf.trades WHERE created_at >= ${ago(7 * DAY)}::timestamptz GROUP BY product_id, city_id)
    SELECT s.product_id, s.city_id, s.kg::text AS stock, coalesce(v.kg, 0)::text AS vol
    FROM s LEFT JOIN v ON v.product_id = s.product_id AND v.city_id = s.city_id
    WHERE s.kg > greatest(coalesce(v.kg, 0) * ${EXCESS_FACTOR}, ${EXCESS_MIN_KG})`);
  for (const r of excess) {
    const top = await run(deps, sql`
      SELECT h.company_id::text AS id FROM cf.holdings h JOIN cf.companies c ON c.id = h.company_id
      WHERE c.is_system = false AND h.product_id = ${r.product_id} AND h.city_id = ${r.city_id} AND h.qty_kg > 0
      ORDER BY h.qty_kg DESC LIMIT 3`);
    if (await raiseAlert(deps.db, {
      kind: "excess_inventory", severity: "info", productId: r.product_id, cityId: r.city_id, companyIds: top.map((t) => t.id!),
      details: { stockKg: Number(r.stock), volume7dKg: Number(r.vol), factor: EXCESS_FACTOR }, dedupeKey: `excess:${r.product_id}:${r.city_id}:${day}`, at: now,
    })) raised++;
  }

  // Servet sıçraması
  const wealth = await run(deps, sql`
    WITH latest AS (
      SELECT DISTINCT ON (company_id) company_id, at, net_worth FROM cf.company_snapshots
      WHERE at >= ${ago(3 * HOUR)}::timestamptz AND at <= ${at}::timestamptz ORDER BY company_id, at DESC)
    SELECT l.company_id::text AS id, l.net_worth::text AS after, b.net_worth::text AS before, l.at::text AS at_txt
    FROM latest l
    JOIN cf.companies c ON c.id = l.company_id AND c.is_system = false
    JOIN LATERAL (SELECT net_worth FROM cf.company_snapshots s WHERE s.company_id = l.company_id AND s.at <= l.at - interval '24 hours'
                  ORDER BY s.at DESC LIMIT 1) b ON true`);
  for (const r of wealth) {
    const before = BigInt(r.before!), after = BigInt(r.after!);
    const g = growthBp(before, after);
    if (g === null || g < WEALTH_SPIKE_BP || after <= WEALTH_SPIKE_MIN) continue;
    if (await raiseAlert(deps.db, {
      kind: "wealth_spike", severity: "high", companyIds: [r.id!],
      details: { netWorthBefore: m(before), netWorthAfter: m(after), growthBp: g }, dedupeKey: `wealth_spike:${r.id}:${day}`, at: now,
    })) raised++;
  }

  // Fiyat sıçraması: referans 24 saatte ±%40
  const spikes = await run(deps, sql`
    SELECT r.product_id, r.city_id, r.ref_price_per_kg::text AS cur, o.ref_price_per_kg::text AS old
    FROM cf.price_refs r
    JOIN LATERAL (SELECT h.ref_price_per_kg FROM cf.price_history h
                  WHERE h.product_id = r.product_id AND h.city_id = r.city_id
                    AND h.at <= ${ago(DAY)}::timestamptz AND h.at >= ${ago(3 * DAY)}::timestamptz
                  ORDER BY h.at DESC LIMIT 1) o ON true`);
  for (const r of spikes) {
    const g = growthBp(BigInt(r.old!), BigInt(r.cur!));
    if (g === null || Math.abs(g) < PRICE_SPIKE_BP) continue;
    if (await raiseAlert(deps.db, {
      kind: "price_spike", severity: "warn", productId: r.product_id, cityId: r.city_id,
      details: { refBefore: r.old!, refAfter: r.cur!, changeBp: g }, dedupeKey: `price_spike:${r.product_id}:${r.city_id}:${day}`, at: now,
    })) raised++;
  }

  // Taşımacısız iş
  const jobs = await run(deps, sql`
    SELECT j.id::text AS id, j.shipper_company_id::text AS shipper, j.pay_amount::text AS pay, j.origin_city_id, j.dest_city_id,
           (extract(epoch FROM (${at}::timestamptz - j.created_at)) / 3600)::int::text AS hours
    FROM cf.freight_jobs j
    WHERE j.status = 'open' AND j.created_at <= ${ago(UNFILLED_FREIGHT_HOURS * HOUR)}::timestamptz AND j.deadline_at > ${at}::timestamptz`);
  for (const r of jobs) {
    if (await raiseAlert(deps.db, {
      kind: "unfilled_freight", severity: "warn", cityId: r.origin_city_id, companyIds: [r.shipper!],
      details: { jobId: r.id!, payAmount: r.pay!, destCityId: r.dest_city_id ?? null, hoursOpen: Number(r.hours) }, dedupeKey: `unfilled_freight:${r.id}`, at: now,
    })) raised++;
  }

  // Girdi eksikliğinden duran hat
  const stalled = await run(deps, sql`
    SELECT f.id::text AS id, f.company_id::text AS company, f.city_id, f.type,
           f.stalled_reason->>'productId' AS product, f.stalled_reason->>'recipeId' AS recipe, f.stalled_reason->>'at' AS since
    FROM cf.facilities f
    WHERE f.state = 'ready' AND f.stalled_reason->>'code' = 'MISSING_INPUT'`);
  for (const r of stalled) {
    if (await raiseAlert(deps.db, {
      kind: "stalled_production", severity: "info", productId: r.product, cityId: r.city_id, companyIds: [r.company!],
      details: { facilityId: r.id!, buildingType: r.type ?? null, recipeId: r.recipe ?? null, since: r.since ?? null }, dedupeKey: `stalled:${r.id}:${r.since ?? ""}`, at: now,
    })) raised++;
  }
  return raised;
}

/** ipRetentionDays öncesi ilk görülen bağlantı kayıtlarını sil (sürekli bağlanan hesap için de karma 30 günde yenilenir) */
export async function cleanupConnectionRecords(deps: Deps, now: Date): Promise<number> {
  const days = deps.catalog.settings.ipRetentionDays;
  const cutoff = new Date(now.getTime() - days * DAY);
  const del = await deps.db.delete(connectionRecords).where(lt(connectionRecords.firstSeenAt, cutoff)).returning({ id: connectionRecords.id });
  return del.length;
}

export function registerFairplayTasks(): void {
  registerTask({ name: "fairplay.price_scan", everyMs: 5 * 60_000, run: scanPriceAnomalies });
  registerTask({ name: "fairplay.market_watch", everyMs: 10 * 60_000, run: scanMarketWatch });
  registerTask({ name: "fairplay.ip_cleanup", everyMs: DAY, run: cleanupConnectionRecords });
}
