import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { playerActions } from "../db/schema";

/** Ticaret dışı niyetler için kayıtlı sonuç: JSON'a yazılabilir düz nesne. */
export type StoredResult = Record<string, unknown>;

/** Anahtar sırası ve değer türü sabit bir özet (aynı niyet = aynı hash). */
export function payloadHash(kind: string, payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const canonical = JSON.stringify([kind, keys.map((k) => [k, payload[k]])]);
  return createHash("sha256").update(canonical).digest("hex");
}

export class ActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Claim = { fresh: true } | { fresh: false; result: StoredResult };

/**
 * player_actions satırını çağıranın transaction'ında rezerve eder.
 * - Yeni anahtar: { fresh: true }; çağıran işi yapar ve complete() ile sonucu yazar.
 * - Aynı anahtar + aynı niyet: kayıtlı sonuç döner (iş tekrarlanmaz).
 * - Aynı anahtar + farklı niyet: IDEMPOTENCY_MISMATCH.
 * Eşzamanlı iki istek aynı anahtarla gelirse ikincisi PK üzerinde ilkinin commit'ini bekler.
 */
export async function claimAction(
  tx: Tx,
  playerId: string,
  clientKey: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<Claim> {
  const hash = payloadHash(kind, payload);
  const inserted = await tx
    .insert(playerActions)
    .values({ playerId, clientKey, kind, payloadHash: hash })
    .onConflictDoNothing({ target: [playerActions.playerId, playerActions.clientKey] })
    .returning({ clientKey: playerActions.clientKey });
  if (inserted.length > 0) return { fresh: true };

  const [prev] = await tx
    .select()
    .from(playerActions)
    .where(and(eq(playerActions.playerId, playerId), eq(playerActions.clientKey, clientKey)));
  if (!prev) throw new ActionError("INTERNAL");
  if (prev.kind !== kind || prev.payloadHash !== hash) throw new ActionError("IDEMPOTENCY_MISMATCH");
  if (!prev.result) throw new ActionError("INTERNAL");
  return { fresh: false, result: prev.result };
}

export async function completeAction(tx: Tx, playerId: string, clientKey: string, result: StoredResult): Promise<void> {
  await tx
    .update(playerActions)
    .set({ result })
    .where(and(eq(playerActions.playerId, playerId), eq(playerActions.clientKey, clientKey)));
}
