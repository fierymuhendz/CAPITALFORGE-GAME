/**
 * POST /account/dissolve: şirketi kapat.
 * - Açık piyasa emirleri iptal edilir (ilan rezervi serbest, alım emri emaneti iade).
 * - Önerilmiş (henüz kabul edilmemiş) sözleşmeler iptal edilir.
 * - Açık kredi veya gecikmiş borç varsa kapanış reddedilir (OPEN_LOAN / ARREARS); borç kapanışla silinemez.
 * - Kabul edilmiş sözleşme, açık taşıma işi veya yoldaki araç varsa kapanış reddedilir (CONFLICT, reason ile):
 *   bu yükümlülüklerin iptal cezası Modül B kurallarıyla işlenmeden şirket kapanamaz.
 * - Çalışan üretim işleri iptal edilir (wip kapanışla silinir), süren araştırma durur.
 * - Arsa serbest, tesis demolished, araçlar sold, stok ve bakiyeler defterde exp_other/equity ile kapanır.
 * Geçmiş kayıtlar (defter, satışlar, hareketler) silinmez.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { companies, contracts, facilities, freightJobs, holdings, loans, marketOrders, plots, productionJobs, research, vehicles } from "../db/schema";
import type { Tx } from "../db/client";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { removeStock, releaseStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { rawBalances } from "../finance/report";
import { lockAccounts } from "../finance/locks";

const ASSET_CODES = ["cash", "inventory", "wip", "escrow", "prepaid_freight", "fixed_assets"];
const LIABILITY_CODES = ["loans", "arrears"];

export async function dissolveCompany(tx: Tx, uow: UnitOfWork, companyId: string, confirmName: string, now: Date): Promise<{ ok: true }> {
  const c = (await tx.select().from(companies).where(and(eq(companies.id, companyId), isNull(companies.dissolvedAt))).for("update"))[0];
  if (!c) fail("NOT_FOUND");
  if (confirmName.trim().toLowerCase() !== c.nameLower) fail("BAD_REQUEST", { issue: "confirmName" });

  // Borç silme açığı: açık kredisi veya gecikmiş borcu olan şirket kapanamaz (önce ödenir)
  const openLoan = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.companyId, companyId), eq(loans.status, "active"))).limit(1);
  if (openLoan[0]) fail("CONFLICT", { reason: "OPEN_LOAN" });
  await lockAccounts(tx, companyId, ["arrears"]);
  if (((await rawBalances(tx, companyId)).arrears ?? 0n) !== 0n) fail("CONFLICT", { reason: "ARREARS" });

  const active = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.status, "active"), or(eq(contracts.sellerCompanyId, companyId), eq(contracts.buyerCompanyId, companyId))))
    .limit(1);
  if (active[0]) fail("CONFLICT", { reason: "ACTIVE_CONTRACT" });
  const jobs = await tx
    .select({ id: freightJobs.id })
    .from(freightJobs)
    .where(and(inArray(freightJobs.status, ["open", "assigned", "in_transit"]), or(eq(freightJobs.shipperCompanyId, companyId), eq(freightJobs.carrierCompanyId, companyId))))
    .limit(1);
  if (jobs[0]) fail("CONFLICT", { reason: "OPEN_FREIGHT_JOB" });
  const moving = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, "in_transit"))).limit(1);
  if (moving[0]) fail("CONFLICT", { reason: "VEHICLE_IN_TRANSIT" });

  // Önerilmiş sözleşmeler (para hareketi yok)
  await tx
    .update(contracts)
    .set({ status: "cancelled", closedAt: now, cancelledBy: null })
    .where(and(eq(contracts.status, "proposed"), or(eq(contracts.proposerCompanyId, companyId), eq(contracts.counterpartyCompanyId, companyId))));

  // Açık piyasa emirleri
  const orders = await tx.select().from(marketOrders).where(and(eq(marketOrders.companyId, companyId), eq(marketOrders.status, "open"))).orderBy(marketOrders.id).for("update");
  for (const o of orders) {
    if (o.side === "sell") {
      await releaseStock(tx, { companyId, cityId: o.cityId, productId: o.productId, quality: o.quality }, o.remainingKg);
    } else if (o.escrowRemaining > 0n) {
      await post(tx, {
        kind: "order_cancel", idempotencyKey: `dissolve-order:${o.id}`, refType: "market_order", refId: o.id, at: now, memo: "Kapanışta emir iadesi",
        lines: [{ account: co(companyId, "cash"), amount: o.escrowRemaining }, { account: co(companyId, "escrow"), amount: -o.escrowRemaining }],
      });
    }
    await tx.update(marketOrders).set({ status: "cancelled", escrowRemaining: 0n, closedAt: now }).where(eq(marketOrders.id, o.id));
  }

  // Stok: tamamı maliyetiyle çıkar (defterde inventory kapanışı aşağıda)
  const hs = await tx.select().from(holdings).where(eq(holdings.companyId, companyId)).orderBy(holdings.id).for("update");
  for (const h of hs) {
    if (h.reservedKg > 0) fail("CONFLICT", { reason: "RESERVED_STOCK" });
    if (h.qtyKg > 0) await removeStock(tx, { companyId, cityId: h.cityId, productId: h.productId, quality: h.quality }, h.qtyKg, { kind: "dissolve", refType: "company", refId: companyId, at: now });
  }

  // Defter kapanışı: varlıklar → exp_other, borçlar → equity (şirket içinde dengeli, tek işlem)
  await lockAccounts(tx, companyId, [...ASSET_CODES, ...LIABILITY_CODES]);
  const b = await rawBalances(tx, companyId);
  const lines: Array<{ account: ReturnType<typeof co>; amount: bigint }> = [];
  for (const code of ASSET_CODES) {
    const v = b[code] ?? 0n;
    if (v !== 0n) lines.push({ account: co(companyId, code), amount: -v }, { account: co(companyId, "exp_other"), amount: v });
  }
  for (const code of LIABILITY_CODES) {
    const v = b[code] ?? 0n; // negatif (alacak)
    if (v !== 0n) lines.push({ account: co(companyId, code), amount: -v }, { account: co(companyId, "equity"), amount: v });
  }
  await post(tx, { kind: "dissolve", idempotencyKey: `dissolve:${companyId}`, refType: "company", refId: companyId, at: now, memo: "Şirket kapanışı", lines });

  await tx.update(loans).set({ status: "defaulted", nextDueAt: null }).where(and(eq(loans.companyId, companyId), eq(loans.status, "active")));
  await tx.update(productionJobs).set({ status: "cancelled", repeat: false, completedAt: now }).where(and(eq(productionJobs.companyId, companyId), eq(productionJobs.status, "running")));
  await tx.update(research).set({ targetLevel: null, endsAt: null }).where(eq(research.companyId, companyId));
  await tx.update(facilities).set({ state: "demolished", upgradeKind: null, upgradeTarget: null, upgradeEndsAt: null, stalledReason: null }).where(eq(facilities.companyId, companyId));
  await tx.update(vehicles).set({ status: "sold", cityId: null, currentShipmentId: null }).where(eq(vehicles.companyId, companyId));
  await tx.update(plots).set({ ownerCompanyId: null, purchasedAt: null }).where(eq(plots.ownerCompanyId, companyId));
  await tx.update(companies).set({ dissolvedAt: now }).where(eq(companies.id, companyId));
  uow.invalidate(companyId, "company", "inventory", "facilities", "finance", "map");
  uow.world("map", "market");
  return { ok: true };
}
