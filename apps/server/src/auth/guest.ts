import { PARAMS } from "@capitalforge/economy";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, players } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

export type GuestResult = { ok: true; playerId: string; username: string } | { ok: false; error: "USERNAME_TAKEN" };

/**
 * Tek transaction'da oyuncu + cüzdan + başlangıç parası.
 * Ad (büyük/küçük harf duyarsız) alınmışsa mevcut oyuncu devralınmaz, USERNAME_TAKEN döner.
 * Başlangıç parası: system:mint −S, oyuncu +S; anahtar grant:start:<playerId>.
 */
export async function createGuest(db: Db, username: string): Promise<GuestResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(players).values({ username }).onConflictDoNothing().returning({ id: players.id });
    if (inserted.length === 0) return { ok: false, error: "USERNAME_TAKEN" } as const;
    const playerId = inserted[0]!.id;

    const [wallet] = await tx.insert(accounts).values({ playerId, kind: "player" }).returning({ id: accounts.id });
    const [mint] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, "system:mint"));
    if (!mint) throw new Error("system:mint hesabı yok (seed uygulanmamış)");

    const S = PARAMS.startingBalance;
    await applyTransfer(tx, `grant:start:${playerId}`, "grant:start", [
      { accountId: mint.id, amount: -S },
      { accountId: wallet!.id, amount: S },
    ]);
    return { ok: true, playerId, username } as const;
  });
}
