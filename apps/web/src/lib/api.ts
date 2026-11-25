/**
 * API istemcisi. Tüm istekler aynı kökten /api/* (Caddy önek kırpar). Değiştiren istekler
 * x-cf-intent başlığı ve idempotencyKey taşır. Hata yanıtı { error: { code } } → ApiError.
 */
import type { ErrorCode } from "@capitalforge/shared";

export class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number, readonly details?: Record<string, string | number>, readonly reqId?: string) {
    super(code);
  }
}

export function newKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function qs(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return "";
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function req<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "content-type": "application/json", "x-cf-intent": "1", ...extra },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("INTERNAL", 0);
  }
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    if (res.ok) throw new ApiError("INTERNAL", res.status);
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: ErrorCode; reqId?: string; details?: Record<string, string | number> } } | null)?.error;
    throw new ApiError(e?.code ?? (res.status === 404 ? "NOT_FOUND" : "INTERNAL"), res.status, e?.details, e?.reqId);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) => req<T>("GET", path + qs(params)),
  /** idempotencyKey otomatik eklenir (gövdede yoksa) */
  post: <T>(path: string, body: Record<string, unknown> = {}, headers?: Record<string, string>) => req<T>("POST", path, { idempotencyKey: newKey(), ...body }, headers),
  patch: <T>(path: string, body: Record<string, unknown> = {}) => req<T>("PATCH", path, body),
};

/** İstemci hatasını sunucu günlüğüne bildir (en fazla birkaç kez, sessiz). */
let reported = 0;
export function reportClientError(message: string, stack?: string): void {
  if (reported++ > 5 || typeof window === "undefined") return;
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", "x-cf-intent": "1" },
    body: JSON.stringify({ message: message.slice(0, 500), stack: stack?.slice(0, 4000), url: window.location.pathname }),
  }).catch(() => undefined);
}
