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
};

function parseTrustProxy(value: string | undefined): boolean | string[] {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
