import type { ActionErrorCode, ActionKind, ActionResult } from "@capitalforge/shared";
import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { accounts, gameClock } from "../db/schema";
import { ActionError, claimAction, completeAction } from "./idempotency";

/** İş mantığının döndürdüğü başarı gövdesi. */
export interface ActionOutcome {
  refId?: string;
  /** Oyuncu bakiyesine etki (kuruş); para hareketi yoksa 0n. */
  amount: bigint;
}

const walletBalance = async (tx: Tx, playerId: string): Promise<bigint> => {
  const [w] = await tx
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  return w?.balance ?? 0n;
};

/**
 * Ticaret dışı niyetlerin ortak çerçevesi: tek transaction, önce player_actions rezervasyonu,
 * sonra iş mantığı. İş hataları (ActionError) transaction'ı geri alır ve { ok:false } döner;
 * beklenmeyen hatalar INTERNAL olur ve ayrıntı sunucu günlüğünde kalır.
 */
export async function runAction(
  db: Db,
  playerId: string,
  idempotencyKey: string,
  kind: ActionKind,
  payload: Record<string, unknown>,
  work: (tx: Tx) => Promise<ActionOutcome>,
): Promise<ActionResult> {
  try {
    return await db.transaction(async (tx): Promise<ActionResult> => {
      const claim = await claimAction(tx, playerId, idempotencyKey, kind, payload);
      if (!claim.fresh) {
        const prev = claim.result as { refId?: string; amount?: string };
        return {
          ok: true,
          kind,
          duplicate: true,
          idempotencyKey,
          ...(prev.refId ? { refId: prev.refId } : {}),
          amount: prev.amount ?? "0",
          balance: (await walletBalance(tx, playerId)).toString(),
        };
      }
      const outcome = await work(tx);
      await completeAction(tx, playerId, idempotencyKey, {
        refId: outcome.refId ?? null,
        amount: outcome.amount.toString(),
      });
      return {
        ok: true,
        kind,
        duplicate: false,
        idempotencyKey,
        ...(outcome.refId ? { refId: outcome.refId } : {}),
        amount: outcome.amount.toString(),
        balance: (await walletBalance(tx, playerId)).toString(),
      };
    });
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, error: err.code as ActionErrorCode, idempotencyKey };
    console.error(`${kind} hatası`, err);
    return { ok: false, error: "INTERNAL", idempotencyKey };
  }
}

/** Sistem hesabı kimliği (seed ile var olmalı). */
export async function systemAccountId(tx: Tx, code: string): Promise<string> {
  const [a] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, code));
  if (!a) throw new Error(`sistem hesabı yok (seed uygulanmamış): ${code}`);
  return a.id;
}

/** Oyuncu cüzdanını kilitler (kilit sırasında envanterden önce). */
export async function lockWallet(tx: Tx, playerId: string): Promise<{ id: string; balance: bigint }> {
  const [w] = await tx
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")))
    .for("update");
  if (!w) throw new ActionError("UNAUTHORIZED");
  return w;
}

export async function currentTick(tx: Tx | Db): Promise<bigint> {
  const [c] = await tx.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
  if (!c) throw new Error("game_clock satırı yok (seed uygulanmamış)");
  return c.tick;
}
