import { type FacilityType, upkeep, upkeepPeriod } from "@capitalforge/economy";
import { and, asc, count, eq, gt, lt } from "drizzle-orm";
import { lockWallet, systemAccountId } from "../actions/run";
import { reportError } from "../observability/log";
import type { Db } from "../db/client";
import { companies, facilities } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

export const UPKEEP_BATCH = 200;
/** Askıdaki tesis bu kadar tick'te bir yeniden denenir (her tick denemek gereksiz yük olur). */
export const SUSPENDED_RETRY_TICKS = 60n;
/**
 * Birikebilecek azami bakım borcu (dönem). Daha eski dönemler affedilir; böylece uzun süre
 * girmeyen yeni oyuncu ezilmez. Affedilen dönemler tahsil edilmez; ödemeden sonra tesis aktif olur.
 */
export const MAX_DEBT_PERIODS = 24n;

export type UpkeepOutcome = "paid" | "suspended" | "skipped";

/**
 * Tek tesisin bakımı, küçük bir transaction'da. Kilit sırası: companies → facilities → oyuncu hesabı.
 * `upkeep_paid_period < dönem` koşulu kilit altında yeniden denetlenir. Ödenmemiş dönem sayısı
 * (dönem − upkeep_paid_period, en çok MAX_DEBT_PERIODS) × dönem bakımı TEK transferde tahsil edilir
 * (anahtar `upkeep:<tesis>:<dönem>` benzersiz). Bakiye bunun tamamına yetmezse hiçbir şey kesilmez (kısmi ödeme
 * yok), tesis `suspended` olur ve upkeep_paid_period İLERLEMEZ: borç birikir, bakım fazı tesisi yeniden dener;
 * ödenince tesis yeniden `active` olur. Bakiye hiçbir zaman negatife düşmez.
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

    const owed = period - f.upkeepPaidPeriod;
    const billed = owed > MAX_DEBT_PERIODS ? MAX_DEBT_PERIODS : owed;
    const perPeriod = upkeep(f.type as FacilityType, BigInt(f.level), ownedCount);
    const amount = perPeriod * billed;
    if (amount === 0n) {
      await tx.update(facilities).set({ status: "active", upkeepPaidPeriod: period }).where(eq(facilities.id, f.id));
      return "paid";
    }
    const wallet = await lockWallet(tx, company.playerId);
    if (wallet.balance < amount) {
      if (f.status !== "suspended") await tx.update(facilities).set({ status: "suspended" }).where(eq(facilities.id, f.id));
      return "suspended";
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

/**
 * Bakım fazı: vadesi gelen tesisleri id anahtarlı sayfalarla, tesis başına ayrı transaction ile işler.
 * Askıdaki tesisler yalnızca SUSPENDED_RETRY_TICKS'te bir denenir.
 */
export async function runUpkeepPhase(db: Db, tick: bigint, maxBatches = 10): Promise<number> {
  const period = upkeepPeriod(tick);
  const retrySuspended = tick % SUSPENDED_RETRY_TICKS === 0n;
  let processed = 0;
  let lastId: string | null = null;
  for (let i = 0; i < maxBatches; i++) {
    const due: { id: string; companyId: string }[] = await db
      .select({ id: facilities.id, companyId: facilities.companyId })
      .from(facilities)
      .where(
        and(
          lt(facilities.upkeepPaidPeriod, period),
          retrySuspended ? undefined : eq(facilities.status, "active"),
          lastId ? gt(facilities.id, lastId) : undefined,
        ),
      )
      .orderBy(asc(facilities.id))
      .limit(UPKEEP_BATCH);
    if (due.length === 0) break;
    for (const f of due) {
      try {
        const r = await chargeUpkeep(db, f.id, f.companyId, period);
        if (r !== "skipped") processed++;
      } catch (err) {
        reportError(err, { what: "bakım hatası", facilityId: f.id });
      }
    }
    if (due.length < UPKEEP_BATCH) break;
    lastId = due[due.length - 1]!.id;
  }
  return processed;
}
