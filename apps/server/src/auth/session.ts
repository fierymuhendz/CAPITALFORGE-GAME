import { createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import type { Redis } from "../redis";

export interface Session {
  playerId: string;
  username: string;
}

/** Redis'te ham token değil, SHA-256 özeti anahtar olur. */
const keyOf = (token: string) => `sess:${createHash("sha256").update(token).digest("hex")}`;

export async function createSession(redis: Redis, session: Session): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(keyOf(token), JSON.stringify(session), "EX", config.sessionTtlSeconds);
  return token;
}

/** Geçersiz/süresi dolmuş token için null. Redis hatasında istisna fırlatır. */
export async function getSession(redis: Redis, token: string | undefined | null): Promise<Session | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const raw = await redis.get(keyOf(token));
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
