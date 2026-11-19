import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";

/** err serileştiricisi: yalnızca type, message, stack, code. */
export function safeErr(err: unknown): Record<string, unknown> {
  if (typeof err !== "object" || err === null) return { type: typeof err, message: String(err) };
  const e = err as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
  const out: Record<string, unknown> = { type: typeof e.name === "string" ? e.name : "Error" };
  if (typeof e.message === "string") out.message = e.message;
  if (typeof e.stack === "string") out.stack = e.stack;
  if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
  return out;
}

/**
 * Tek günlük örneği. Yetki başlığı, token ve parola alanları her zaman gizlenir.
 * Fastify'a loggerInstance olarak verilir.
 */
export function createLogger(destination?: NodeJS.WritableStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      // Hata nesneleri beyaz listeyle serileştirilir: ek alanlar (ör. SQL parametreleri, istek gövdesi) yazılmaz.
      serializers: { err: safeErr },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.authorization",
          "*.token",
          "*.*.token",
          "*.password",
          "token",
          "password",
        ],
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
