import { type FacilityType, upkeep, upkeepPeriod } from "@capitalforge/economy";
import { and, asc, count, eq, lt } from "drizzle-orm";
import { lockWallet, systemAccountId } from "../actions/run";
import type { Db } from "../db/client";
import { companies, facilities } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

export const UPKEEP_BATCH = 200;

export type UpkeepOutcome = "paid" | "suspended" | "skipped";

/**
 * Tek tesisin o dönemki bakımı, küçük bir transaction'da. Kilit sırası: companies → facilities → oyuncu hesabı.
 * `upkeep_paid_period < dönem` koşulu kilit altında yeniden denetlenir; aynı dönem iki kez kesilmez
 * (ayrıca transfer anahtarı `upkeep:<tesis>:<dönem>` benzersizdir). Bakiye yetmezse tesis `suspended`
 * olur, borç oluşmaz, dönem ödenmiş sayılır; sonraki dönemde ödenirse yeniden `active` olur.
 */
export async function chargeUpkeep(db: Db, facilityId: string, companyId: string, period: bigint): Promise<UpkeepOutcome> {
  return db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
    if (!company) return "skipped";
    const [f] = await tx.select().from(facilities).where(eq(facilities.id, facilityId)).for("update");
    if (!f || f.upkeepPaidPeriod >= period) return "skipped";

    // Bakım şirketteki tesis sayısıyla artar (çok tesisli para basmayı dengeler); şirket kilidi altında sayılır.
    const [cnt] = await tx.select({ n: count() }).from(facilities).where(eq(facilities.companyId, companyId));
    const ownedCount = BigInt(cnt?.n ?? 1);

    const amount = upkeep(f.type as FacilityType, BigInt(f.level), ownedCount);
    const wallet = await lockWallet(tx, company.playerId);
    if (amount === 0n || wallet.balance < amount) {
      await tx
        .update(facilities)
        .set({ status: amount === 0n ? "active" : "suspended", upkeepPaidPeriod: period })
        .where(eq(facilities.id, f.id));
      return amount === 0n ? "paid" : "suspended";
    }
    const fees = await systemAccountId(tx, "system:fees");
    await applyTransfer(tx, `upkeep:${f.id}:${period}`, "upkeep", [
      { accountId: wallet.id, amount: -amount },
      { accountId: fees, amount },
    ]);
    await tx.update(facilities).set({ status: "active", upkeepPaidPeriod: period }).where(eq(facilities.id, f.id));
    return "paid";
  });
}

/** Bakım fazı: vadesi gelen tesisleri partiler halinde, tesis başına ayrı transaction ile işler. */
export async function runUpkeepPhase(db: Db, tick: bigint, maxBatches = 10): Promise<number> {
  const period = upkeepPeriod(tick);
  let processed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const due = await db
      .select({ id: facilities.id, companyId: facilities.companyId })
      .from(facilities)
      .where(and(lt(facilities.upkeepPaidPeriod, period)))
      .orderBy(asc(facilities.id))
      .limit(UPKEEP_BATCH);
    if (due.length === 0) break;
    for (const f of due) {
      try {
        const r = await chargeUpkeep(db, f.id, f.companyId, period);
        if (r !== "skipped") processed++;
      } catch (err) {
        console.error("bakım hatası", f.id, err);
      }
    }
    if (due.length < UPKEEP_BATCH) break;
  }
  return processed;
}
