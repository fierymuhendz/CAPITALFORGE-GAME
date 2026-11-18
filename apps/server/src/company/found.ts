import { PARAMS } from "@capitalforge/economy";
import type { ActionResult, FoundCompany } from "@capitalforge/shared";
import { eq } from "drizzle-orm";
import { ActionError } from "../actions/idempotency";
import { lockWallet, runAction, systemAccountId } from "../actions/run";
import type { Db } from "../db/client";
import { companies } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

/**
 * Şirket kur: oyuncu −ücret, system:fees +ücret. Kilit sırası: companies → oyuncu hesabı.
 * Oyuncu başına tek şirket (player_id UNIQUE) ve ad benzersizliği (lower(name)) veritabanı kısıtıdır;
 * ON CONFLICT DO NOTHING ile transaction'ı bozmadan hangisinin çakıştığı ayırt edilir.
 */
export function foundCompany(db: Db, playerId: string, input: FoundCompany): Promise<ActionResult> {
  return runAction(db, playerId, input.idempotencyKey, "foundCompany", { name: input.name }, async (tx) => {
    const fee = PARAMS.companyFoundingFee;

    const inserted = await tx
      .insert(companies)
      .values({ playerId, name: input.name })
      .onConflictDoNothing()
      .returning({ id: companies.id });
    if (inserted.length === 0) {
      const [mine] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.playerId, playerId));
      throw new ActionError(mine ? "COMPANY_EXISTS" : "NAME_TAKEN");
    }
    const companyId = inserted[0]!.id;

    const wallet = await lockWallet(tx, playerId);
    if (wallet.balance < fee) throw new ActionError("INSUFFICIENT_FUNDS");
    const fees = await systemAccountId(tx, "system:fees");
    const t = await applyTransfer(tx, `company:found:${playerId}:${companyId}`, "company:found", [
      { accountId: wallet.id, amount: -fee },
      { accountId: fees, amount: fee },
    ]);
    // Anahtar yeni şirket kimliğini içerir (geri alma/yeniden kurulumdan kalan eski anahtarlarla çakışmaz); idempotency player_actions'tadır.
    if (t.status === "duplicate") throw new Error("Beklenmeyen yinelenen kuruluş transferi");
    return { refId: companyId, amount: -fee };
  });
}
