function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Ortam değişkeni eksik: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 2567),
  databaseUrl: () => required("DATABASE_URL"),
  redisUrl: () => resolveRedisUrl(required("REDIS_URL"), process.env.NODE_ENV),
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  /** Oturum token'ının Redis'te yaşama süresi (saniye). Varsayılan 7 gün. */
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 604_800),
  /** Reverse proxy arkasında istemci IP'sini X-Forwarded-For'dan almak için. */
  // "true": tüm vekillere güven (sadece geliştirme). Virgüllü IP/CIDR listesi: yalnızca bunlara güven.
  trustProxy: resolveTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV),
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

/** Üretimde TRUST_PROXY zorunlu: yoksa tüm istekler proxy IP'sinden görünür ve IP hız sınırları işlemez. */
export function resolveTrustProxy(value: string | undefined, nodeEnv: string | undefined): boolean | string[] {
  const parsed = parseTrustProxy(value);
  if (nodeEnv === "production" && (parsed === false || (Array.isArray(parsed) && parsed.length === 0))) {
    throw new Error("Ortam değişkeni eksik veya geçersiz: TRUST_PROXY (üretimde zorunlu)");
  }
  return parsed;
}

function parseTrustProxy(value: string | undefined): boolean | string[] {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/** Üretimde Redis adresinde parola zorunlu (redis://:parola@host:port). Hata iletisi adresi/parolayı içermez. */
export function resolveRedisUrl(value: string, nodeEnv: string | undefined): string {
  if (nodeEnv !== "production") return value;
  let password = "";
  try {
    password = new URL(value).password;
  } catch {
    throw new Error("Ortam değişkeni geçersiz: REDIS_URL (adres okunamadı)");
  }
  if (!password) throw new Error("Ortam değişkeni eksik veya geçersiz: REDIS_URL (üretimde parola zorunlu)");
  return value;
}
