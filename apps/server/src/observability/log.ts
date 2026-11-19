import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";

/**
 * Tek günlük örneği. Yetki başlığı, token ve parola alanları her zaman gizlenir.
 * Fastify'a loggerInstance olarak verilir.
 */
export function createLogger(destination?: NodeJS.WritableStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "*.token", "*.password", "token", "password"],
        censor: "[Redacted]",
      },
    },
    destination,
  );
}

export const logger: FastifyBaseLogger = createLogger();

/** Hata bildirimi: JSON günlüğe yazar (ileride SENTRY_DSN ile Sentry'e iletilebilir). */
export function reportError(err: unknown, ctx: Record<string, unknown> = {}): void {
  logger.error({ ...ctx, err }, typeof ctx.what === "string" ? ctx.what : "hata");
}
