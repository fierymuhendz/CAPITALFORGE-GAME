/**
 * Gecikmiş borç (arrears): pasif hesap, alacak bakiyesi negatiftir. Her nakit girişinden sonra
 * Modül B (satış/teslim) `settleArrears` çağırır; mevcut nakitle ödenebilen kısım kapanır.
 */
import { randomUUID } from "node:crypto";
import type { Tx } from "../db/client";
import type { UnitOfWork } from "../events/bus";
import { fail } from "../errors";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { lockAccounts } from "./locks";

/** Ödenen tutarı döndürür (0n = borç yok veya nakit yok). */
export async function settleArrears(tx: Tx, uow: UnitOfWork, companyId: string, now: Date): Promise<bigint> {
  const b = await lockAccounts(tx, companyId, ["cash", "arrears"]);
  const owed = -(b.arrears ?? 0n);
  const cash = b.cash ?? 0n;
  if (owed <= 0n || cash <= 0n) return 0n;
  const pay = owed < cash ? owed : cash;
  await post(tx, {
    kind: "arrears_settle", idempotencyKey: `arrears-settle:${companyId}:${randomUUID()}`, refType: "company", refId: companyId, at: now,
    memo: "Gecikmiş borç ödemesi",
    lines: [{ account: co(companyId, "arrears"), amount: pay }, { account: co(companyId, "cash"), amount: -pay }],
  });
  await notify(tx, uow, companyId, "arrears_settled", { amount: m(pay), remaining: m(owed - pay) }, now, "/play?tab=finance");
  uow.invalidate(companyId, "company", "finance");
  return pay;
}

/** POST /finance/arrears/pay: elle ödeme. Borç yoksa 0; nakit yoksa INSUFFICIENT_FUNDS. */
export async function payArrearsManually(tx: Tx, uow: UnitOfWork, companyId: string, now: Date): Promise<bigint> {
  const b = await lockAccounts(tx, companyId, ["cash", "arrears"]);
  const owed = -(b.arrears ?? 0n);
  if (owed <= 0n) return 0n;
  if ((b.cash ?? 0n) <= 0n) fail("INSUFFICIENT_FUNDS", { missing: m(owed) });
  return settleArrears(tx, uow, companyId, now);
}
