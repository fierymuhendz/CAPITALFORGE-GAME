/**
 * API istemcisi. Tüm istekler aynı kökten /api/* (Caddy önek kırpar). Değiştiren istekler
 * x-cf-intent başlığı ve idempotencyKey taşır. Hata yanıtı { error: { code } } → ApiError.
 */
import type { ErrorCode } from "@capitalforge/shared";

export class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number, readonly details?: Record<string, string | number>) {
    super(code);
  }
}

export function newKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-cf-intent": "1" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const e = (data as { error?: { code?: ErrorCode; details?: Record<string, string | number> } }).error;
    throw new ApiError(e?.code ?? "INTERNAL", res.status, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => req<T>("GET", path),
  /** idempotencyKey otomatik eklenir (gövdede yoksa) */
  post: <T>(path: string, body: Record<string, unknown> = {}) => req<T>("POST", path, { idempotencyKey: newKey(), ...body }),
  patch: <T>(path: string, body: Record<string, unknown> = {}) => req<T>("PATCH", path, body),
};
