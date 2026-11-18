function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Ortam değişkeni eksik: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 2567),
  databaseUrl: () => required("DATABASE_URL"),
  redisUrl: () => required("REDIS_URL"),
};
