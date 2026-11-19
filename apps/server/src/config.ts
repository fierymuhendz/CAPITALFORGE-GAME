function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Ortam değişkeni eksik: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 2567),
  databaseUrl: () => required("DATABASE_URL"),
  redisUrl: () => required("REDIS_URL"),
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  /** Oturum token'ının Redis'te yaşama süresi (saniye). Varsayılan 7 gün. */
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 604_800),
  /** Reverse proxy arkasında istemci IP'sini X-Forwarded-For'dan almak için. */
  // "true": tüm vekillere güven (sadece geliştirme). Virgüllü IP/CIDR listesi: yalnızca bunlara güven.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  /** Yeni hesapların alım-satım yapamadığı süre (saniye). 0 = kapalı. Saat kaynağı veritabanı now(). */
  newAccountTradeDelaySeconds: parseIntRange("NEW_ACCOUNT_TRADE_DELAY_SECONDS", process.env.NEW_ACCOUNT_TRADE_DELAY_SECONDS, 600, 0, 86_400),
};

/** Boşsa varsayılan; tam sayı değilse veya aralık dışındaysa başlangıçta hata verir. */
export function parseIntRange(name: string, value: string | undefined, def: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return def;
  const n = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Ortam değişkeni geçersiz: ${name} (${min}-${max} arası tam sayı olmalı)`);
  }
  return n;
}

function parseTrustProxy(value: string | undefined): boolean | string[] {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
