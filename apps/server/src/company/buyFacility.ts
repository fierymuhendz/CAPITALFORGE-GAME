import { PARAMS, facilityPrice, upkeepPeriod, type FacilityType } from "@capitalforge/economy";
import type { ActionResult, BuyFacility } from "@capitalforge/shared";
import { count, eq } from "drizzle-orm";
import { ActionError } from "../actions/idempotency";
import { currentTick, lockWallet, runAction, systemAccountId } from "../actions/run";
import type { Db } from "../db/client";
import { companies, facilities } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

/**
 * Tesis satın al: oyuncu −fiyat, system:fees +fiyat. Fiyat sunucuda facilityPrice(tür, sahip olunan sayı)
 * ile hesaplanır. Kilit sırası: companies → facilities (insert) → oyuncu hesabı.
 * Şirket satırı FOR UPDATE ile kilitlenir; böylece aynı şirketin eşzamanlı alımları sırayla işlenir ve
 * tesis limiti yarışmaz. Aynı arsa UNIQUE (city_id, plot_x, plot_y) ile korunur.
 */
export function buyFacility(db: Db, playerId: string, input: BuyFacility): Promise<ActionResult> {
  return runAction(
    db,
    playerId,
    input.idempotencyKey,
    "buyFacility",
    { type: input.type, plotX: input.plotX, plotY: input.plotY },
    async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.playerId, playerId)).for("update");
      if (!company) throw new ActionError("NO_COMPANY");

      const [owned] = await tx.select({ n: count() }).from(facilities).where(eq(facilities.companyId, company.id));
      const ownedCount = BigInt(owned?.n ?? 0);
      if (ownedCount >= PARAMS.maxFacilitiesPerCompany) throw new ActionError("FACILITY_LIMIT");

      const type = input.type as FacilityType;
      const price = facilityPrice(type, ownedCount);
      const tick = await currentTick(tx);

      const inserted = await tx
        .insert(facilities)
        .values({
          companyId: company.id,
          type,
          cityId: company.cityId,
          plotX: input.plotX,
          plotY: input.plotY,
          purchasePrice: price,
          // İlk bakım bir sonraki dönemin başında kesilir.
          upkeepPaidPeriod: upkeepPeriod(tick),
        })
        .onConflictDoNothing()
        .returning({ id: facilities.id });
      if (inserted.length === 0) throw new ActionError("PLOT_TAKEN");
      const facilityId = inserted[0]!.id;

      const wallet = await lockWallet(tx, playerId);
      if (wallet.balance < price) throw new ActionError("INSUFFICIENT_FUNDS");
      const fees = await systemAccountId(tx, "system:fees");
      const t = await applyTransfer(tx, `facility:buy:${playerId}:${input.idempotencyKey}`, `facility:buy:${type}`, [
        { accountId: wallet.id, amount: -price },
        { accountId: fees, amount: price },
      ]);
      if (t.status === "duplicate") throw new Error("Beklenmeyen yinelenen tesis alım transferi");
      return { refId: facilityId, amount: -price };
    },
  );
}
