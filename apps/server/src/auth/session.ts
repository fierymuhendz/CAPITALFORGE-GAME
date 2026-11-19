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
 * Oyuncunun tüm oturumlarını tek atomik adımda siler: üye kümesi okunur, her anahtar silinir, küme silinir
 * ve silinen özetler döner. Araya giren createSession betiğin dışında kalmaz (ya önce eklenir ve silinir, ya sonra kalır).
 */
const REVOKE_ALL = `
local members = redis.call('SMEMBERS', KEYS[1])
for _, h in ipairs(members) do redis.call('DEL', 'sess:' .. h) end
redis.call('DEL', KEYS[1])
return members
`;

/**
 * Çıkış. Geçersiz/bilinmeyen token sessizce yok sayılır (idempotent). all=true oyuncunun tüm oturumlarını kapatır
 * (tek Lua betiği), ardından iptal edilen özetler kanala yayınlanır. Redis hatasında istisna fırlatır.
 */
export async function revokeSession(redis: Redis, token: string | undefined | null, all: boolean): Promise<void> {
  const session = await getSession(redis, token);
  if (!session || !token) return;
  const hash = hashToken(token);
  let hashes = [hash];
  if (all) {
    const members = (await redis.eval(REVOKE_ALL, 1, playerSetKey(session.playerId))) as string[];
    await redis.del(keyOfHash(hash));
    hashes = [...new Set([hash, ...members])];
  } else {
    await redis.multi().del(keyOfHash(hash)).srem(playerSetKey(session.playerId), hash).exec();
  }
  await redis.publish(REVOKE_CHANNEL, JSON.stringify({ hashes }));
}
