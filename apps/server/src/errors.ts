import type { ErrorCode } from "@capitalforge/shared";

const STATUS: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMITED: 429,
  CONFLICT: 409, INTERNAL: 500, TOTP_REQUIRED: 403, ACCOUNT_FROZEN: 403, NOT_PARTY: 403,
  TIME_TRAVEL_DISABLED: 403, IDEMPOTENCY_MISMATCH: 409, CONNECTION_LIMIT: 429,
};

/** Oyun kuralı hatası: istemciye kod olarak gider (iç ayrıntı sızmaz). */
export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, readonly details?: Record<string, string | number>) {
    super(code);
    this.status = STATUS[code] ?? 422;
  }
}

export function fail(code: ErrorCode, details?: Record<string, string | number>): never {
  throw new AppError(code, details);
}
