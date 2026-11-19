import { createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import type { Redis } from "../redis";

export interface Session {
  playerId: string;
  username: string;
}

/** Oturum iptali yayını (Redis pub/sub). Yük: { hashes: string[] }. */
export const REVOKE_CHANNEL = "sess:revoked";

/** Redis'te ham token değil, SHA-256 özeti anahtar olur. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const keyOfHash = (hash: string) => `sess:${hash}`;
const playerSetKey = (playerId: string) => `psess:${playerId}`;

export async function createSession(redis: Redis, session: Session): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  await redis
    .multi()
    .set(keyOfHash(hash), JSON.stringify(session), "EX", config.sessionTtlSeconds)
    .sadd(playerSetKey(session.playerId), hash)
    .expire(playerSetKey(session.playerId), config.sessionTtlSeconds)
    .exec();
  return token;
}

/** Geçersiz/süresi dolmuş token için null. Redis hatasında istisna fırlatır. */
export async function getSession(redis: Redis, token: string | undefined | null): Promise<Session | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  return getSessionByHash(redis, hashToken(token));
}

/** Özetle oturum arama (MarketRoom ham token tutmaz). */
export async function getSessionByHash(redis: Redis, hash: string): Promise<Session | null> {
  const raw = await redis.get(keyOfHash(hash));
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { playerId, username } = v as Record<string, unknown>;
    return typeof playerId === "string" && typeof username === "string" ? { playerId, username } : null;
  } catch {
    return null;
  }
}

/**
 * Çıkış. Geçersiz/bilinmeyen token sessizce yok sayılır (idempotent). all=true oyuncunun tüm oturumlarını kapatır.
 * Silme MULTI ile yapılır, ardından iptal edilen özetler kanala yayınlanır. Redis hatasında istisna fırlatır.
 */
export async function revokeSession(redis: Redis, token: string | undefined | null, all: boolean): Promise<void> {
  const session = await getSession(redis, token);
  if (!session || !token) return;
  const hash = hashToken(token);
  let hashes = [hash];
  if (all) {
    const members = await redis.smembers(playerSetKey(session.playerId));
    hashes = [...new Set([hash, ...members])];
  }
  const m = redis.multi();
  for (const h of hashes) m.del(keyOfHash(h));
  if (all) m.del(playerSetKey(session.playerId));
  else m.srem(playerSetKey(session.playerId), hash);
  await m.exec();
  await redis.publish(REVOKE_CHANNEL, JSON.stringify({ hashes }));
}
