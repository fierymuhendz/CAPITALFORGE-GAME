import { PARAMS, inventoryValue, reliefEligible, reliefPeriod } from "@capitalforge/economy";
import type { ActionResult, ClaimRelief } from "@capitalforge/shared";
import { and, asc, count, eq, gt, inArray } from "drizzle-orm";
import { ActionError } from "../actions/idempotency";
import { currentTick, lockWallet, runAction, systemAccountId } from "../actions/run";
import type { Db, Tx } from "../db/client";
import { accounts, companies, facilities, inventories, products, reliefClaims } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

/** Ödenek durumu: kilitli ya da kilitsiz okunan bakiye/envanterle eşik, tesis ve dönem kontrolü. */
async function evaluate(tx: Tx | Db, playerId: string, cash: bigint, lockInventory: boolean) {
  const tick = await currentTick(tx);
  const period = reliefPeriod(tick);

  const [claimed] = await tx
    .select({ period: reliefClaims.period })
    .from(reliefClaims)
    .where(and(eq(reliefClaims.playerId, playerId), eq(reliefClaims.period, period)));

  const [fac] = await tx
    .select({ n: count() })
    .from(facilities)
    .innerJoin(companies, eq(companies.id, facilities.companyId))
    .where(eq(companies.playerId, playerId));

  const q = tx
    .select({ productId: inventories.productId, quantity: inventories.quantity })
    .from(inventories)
    .where(and(eq(inventories.playerId, playerId), gt(inventories.quantity, 0n)))
    .orderBy(asc(inventories.productId));
  const held = lockInventory ? await q.for("update") : await q;
  const prices = held.length
    ? await tx
        .select({ id: products.id, price: products.price })
        .from(products)
        .where(inArray(products.id, held.map((h) => h.productId)))
    : [];
  const priceOf = new Map(prices.map((p) => [p.id, p.price]));
  const value = inventoryValue(held.map((h) => ({ price: priceOf.get(h.productId) ?? PARAMS.minPrice, qty: h.quantity })));

  const eligible = reliefEligible({ cash, inventoryValue: value, hasFacility: (fac?.n ?? 0) > 0 });
  return { period, eligible: eligible && !claimed };
}

/** Salt okunur sorgu: ödenek şu an talep edilebilir mi (arayüz bayrağı; yetki kararı claimRelief'tedir). */
export async function reliefAvailable(db: Db, playerId: string): Promise<boolean> {
  const [w] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  if (!w) return false;
  return (await evaluate(db, playerId, w.balance, false)).eligible;
}

/**
 * Asgari ödenek: system:mint −R, oyuncu +R. Dönem başına bir (relief_claims PK + transfer anahtarı
 * `relief:<oyuncu>:<dönem>`). Kilit sırası: oyuncu hesabı → inventories. Uygunluk (tesis yok, nakit +
 * envanter değeri eşiğin altı) kilit altında, sunucu verisiyle hesaplanır.
 */
export function claimRelief(db: Db, playerId: string, input: ClaimRelief): Promise<ActionResult> {
  return runAction(db, playerId, input.idempotencyKey, "claimRelief", {}, async (tx) => {
    const wallet = await lockWallet(tx, playerId);
    const { period, eligible } = await evaluate(tx, playerId, wallet.balance, true);
    if (!eligible) throw new ActionError("NOT_ELIGIBLE");

    const amount = PARAMS.reliefAmount;
    const mint = await systemAccountId(tx, "system:mint");
    const t = await applyTransfer(tx, `relief:${playerId}:${period}`, "relief", [
      { accountId: mint, amount: -amount },
      { accountId: wallet.id, amount },
    ]);
    if (t.status === "duplicate") throw new ActionError("NOT_ELIGIBLE");
    const ins = await tx
      .insert(reliefClaims)
      .values({ playerId, period, amount, transferId: t.transferId })
      .onConflictDoNothing()
      .returning({ period: reliefClaims.period });
    if (ins.length === 0) throw new ActionError("NOT_ELIGIBLE");
    return { amount };
  });
}
