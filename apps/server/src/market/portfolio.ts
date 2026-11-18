import type { Portfolio } from "@capitalforge/shared";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, inventories } from "../db/schema";

/** Oyuncunun bakiyesi ve envanteri (yalnızca kendisine gösterilir). */
export async function getPortfolio(db: Db, playerId: string): Promise<Portfolio> {
  const [wallet] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  const items = await db
    .select({ productId: inventories.productId, quantity: inventories.quantity })
    .from(inventories)
    .where(and(eq(inventories.playerId, playerId), gt(inventories.quantity, 0n)))
    .orderBy(asc(inventories.productId));
  return {
    balance: (wallet?.balance ?? 0n).toString(),
    inventory: items.map((i) => ({ productId: i.productId, quantity: i.quantity.toString() })),
  };
}
