import type { Redis } from "../redis";

/** Sabit pencereli sayaç: INCR + ilk artışta PEXPIRE, tek atomik Lua çağrısı. */
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c
`;

/**
 * true = izin verildi, false = sınır aşıldı. Redis hatasında istisna fırlatır:
 * çağıran isteği reddetmelidir (fail closed).
 */
export async function allow(redis: Redis, key: string, limit: number, windowMs: number): Promise<boolean> {
  const count = Number(await redis.eval(SCRIPT, 1, `rl:${key}`, String(windowMs)));
  return count <= limit;
}

export const LIMITS = {
  order: { limit: 5, windowMs: 1_000 },
  guestLogin: { limit: 5, windowMs: 60_000 },
} as const;

export const allowOrder = (redis: Redis, playerId: string) =>
  allow(redis, `order:${playerId}`, LIMITS.order.limit, LIMITS.order.windowMs);

export const allowGuestLogin = (redis: Redis, ip: string) =>
  allow(redis, `guest:${ip}`, LIMITS.guestLogin.limit, LIMITS.guestLogin.windowMs);
