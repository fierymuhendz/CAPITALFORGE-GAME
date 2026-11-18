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
  /** Tüm IP'ler için toplam misafir kaydı tavanı (adres döndürerek hesap fabrikasına karşı). */
  guestLoginGlobal: { limit: 60, windowMs: 60_000 },
} as const;

export const allowOrder = (redis: Redis, playerId: string) =>
  allow(redis, `order:${playerId}`, LIMITS.order.limit, LIMITS.order.windowMs);

/** IPv6 adresini /64 önekine indirger; tek bir ağ içinde adres döndürmek sınırı aşmaz. */
export function ipBucket(ip: string): string {
  if (!ip.includes(":") || ip.startsWith("::ffff:")) return ip.replace(/^::ffff:/, "");
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export async function allowGuestLogin(redis: Redis, ip: string): Promise<boolean> {
  const perIp = await allow(redis, `guest:${ipBucket(ip)}`, LIMITS.guestLogin.limit, LIMITS.guestLogin.windowMs);
  if (!perIp) return false;
  return allow(redis, "guest:all", LIMITS.guestLoginGlobal.limit, LIMITS.guestLoginGlobal.windowMs);
}
