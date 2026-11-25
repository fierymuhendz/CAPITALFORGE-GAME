/** Ortam değişkenleri tek yerde okunur ve doğrulanır. */
import { createHash } from "node:crypto";

function bool(v: string | undefined, d = false): boolean {
  if (v === undefined || v === "") return d;
  return v === "1" || v.toLowerCase() === "true";
}

export interface Config {
  port: number;
  nodeEnv: string;
  isProd: boolean;
  databaseUrl: string;
  redisUrl: string;
  /** oturum ve TOTP şifreleme anahtarlarının türetildiği sır */
  secret: string;
  /** IP karması için ayrı anahtar (secret'tan türetilir) */
  ipHashKey: Buffer;
  totpKey: Buffer;
  trustProxy: boolean | string;
  allowTimeTravel: boolean;
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  adminSetupCode: string | null;
  secureCookies: boolean;
  logLevel: string;
  registrationCode: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const secret = env.JWT_SECRET ?? env.APP_SECRET ?? (isProd ? "" : "dev-secret-degistir");
  if (isProd && secret.length < 32) throw new Error("Üretimde JWT_SECRET en az 32 karakter olmalı");
  const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
  if (isProd && !/^rediss?:\/\/[^@]*:[^@]+@/.test(redisUrl)) throw new Error("Üretimde REDIS_URL parolalı olmalı");
  const tp = env.TRUST_PROXY ?? "false";
  const allowTimeTravel = !isProd && bool(env.ALLOW_TIME_TRAVEL);
  return {
    port: Number(env.PORT ?? 2567),
    nodeEnv,
    isProd,
    databaseUrl: env.DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge",
    redisUrl,
    secret,
    ipHashKey: createHash("sha256").update(`ip:${secret}`).digest(),
    totpKey: createHash("sha256").update(`totp:${secret}`).digest(),
    trustProxy: tp === "true" ? true : tp === "false" ? false : tp,
    allowTimeTravel,
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS ?? 5000),
    adminSetupCode: env.ADMIN_SETUP_CODE && env.ADMIN_SETUP_CODE.length >= 16 ? env.ADMIN_SETUP_CODE : null,
    secureCookies: bool(env.SECURE_COOKIES, isProd),
    logLevel: env.LOG_LEVEL ?? "info",
    registrationCode: env.REGISTRATION_CODE && env.REGISTRATION_CODE.length > 0 ? env.REGISTRATION_CODE : null,
  };
}
