import { PARAMS, inventoryValue, reliefEligible, reliefPeriod } from "@capitalforge/economy";
import type { ActionResult, ClaimRelief } from "@capitalforge/shared";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import { ActionError } from "../actions/idempotency";
import { currentTick, lockWallet, runAction, systemAccountId } from "../actions/run";
import type { Db, Tx } from "../db/client";
import { accounts, companies, facilities, inventories, products, reliefClaims } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

type ProductPrice = { id: string; price: bigint };

/** Ürün satırlarını id artan sırada FOR KEY SHARE kilitler (kilit sırasının ilki) ve fiyatlarını döner. */
const lockProducts = (tx: Tx): Promise<ProductPrice[]> =>
  tx.select({ id: products.id, price: products.price }).from(products).orderBy(asc(products.id)).for("key share");

/**
 * Ödenek durumu: bakiye/envanterle eşik, aktif tesis ve kayan bekleme (son talepten itibaren en az
 * reliefCooldownTicks tick) kontrolü. lockInventory=true iken envanter satırları kilitlenir.
 */
async function evaluate(tx: Tx | Db, playerId: string, cash: bigint, lockInventory: boolean, productRows: ProductPrice[]) {
  const tick = await currentTick(tx);
  const period = reliefPeriod(tick);

  const [last] = await tx
    .select({ claimedTick: reliefClaims.claimedTick })
    .from(reliefClaims)
    .where(eq(reliefClaims.playerId, playerId))
    .orderBy(desc(reliefClaims.claimedTick))
    .limit(1);
  const cooledDown = !last || tick - last.claimedTick >= PARAMS.reliefCooldownTicks;

  const [fac] = await tx
    .select({ n: count() })
    .from(facilities)
    .innerJoin(companies, eq(companies.id, facilities.companyId))
    .where(and(eq(companies.playerId, playerId), eq(facilities.status, "active")));

  const q = tx
    .select({ productId: inventories.productId, quantity: inventories.quantity })
    .from(inventories)
    .where(and(eq(inventories.playerId, playerId), gt(inventories.quantity, 0n)))
    .orderBy(asc(inventories.productId));
  const held = lockInventory ? await q.for("update") : await q;
  const priceOf = new Map(productRows.map((p) => [p.id, p.price]));
  const value = inventoryValue(held.map((h) => ({ price: priceOf.get(h.productId) ?? PARAMS.minPrice, qty: h.quantity })));

  const eligible = reliefEligible({ cash, inventoryValue: value, hasActiveFacility: (fac?.n ?? 0) > 0 });
  return { period, tick, eligible: eligible && cooledDown };
}

/** Salt okunur sorgu: ödenek şu an talep edilebilir mi (arayüz bayrağı; yetki kararı claimRelief'tedir). */
export async function reliefAvailable(db: Db, playerId: string): Promise<boolean> {
  const [w] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  if (!w) return false;
  return (await evaluate(db, playerId, w.balance, false, await db.select({ id: products.id, price: products.price }).from(products))).eligible;
}

/**
 * Asgari ödenek: system:mint −R, oyuncu +R. Kayan bekleme: son talepten itibaren en az reliefCooldownTicks
 * (relief_claims.claimed_tick); dönem PK'sı + transfer anahtarı `relief:<oyuncu>:<dönem>` ikinci savunma.
 * Kilit sırası: products (KEY SHARE) → oyuncu hesabı → inventories. Uygunluk (tesis yok, nakit +
 * envanter değeri eşiğin altı) kilit altında, sunucu verisiyle hesaplanır.
 */
export function claimRelief(db: Db, playerId: string, input: ClaimRelief): Promise<ActionResult> {
  return runAction(db, playerId, input.idempotencyKey, "claimRelief", {}, async (tx) => {
    const productRows = await lockProducts(tx);
    const wallet = await lockWallet(tx, playerId);
    const { period, tick, eligible } = await evaluate(tx, playerId, wallet.balance, true, productRows);
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
      .values({ playerId, period, amount, transferId: t.transferId, claimedTick: tick })
      .onConflictDoNothing()
      .returning({ period: reliefClaims.period });
    if (ins.length === 0) throw new ActionError("NOT_ELIGIBLE");
    return { amount };
  });
}
