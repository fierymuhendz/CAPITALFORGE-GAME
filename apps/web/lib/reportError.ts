import type { ClientErrorReport } from "@capitalforge/shared";

const MAX_PER_PAGE = 5;
const seen = new Set<string>();
let sent = 0;

/**
 * Hatayı sunucuya bildirir. Yalnızca pathname gönderilir (sorgu dizesi ve URL yok).
 * Aynı mesaj tekrar gönderilmez, sayfa başına en fazla 5 bildirim gider. Asla fırlatmaz.
 */
export function reportError(kind: ClientErrorReport["kind"], error: unknown): void {
  try {
    if (typeof window === "undefined" || sent >= MAX_PER_PAGE) return;
    const err = error instanceof Error ? error : null;
    const message = (err?.message || (typeof error === "string" ? error : "") || "Bilinmeyen hata").slice(0, 500);
    if (seen.has(message)) return;
    seen.add(message);
    sent += 1;
    const report: ClientErrorReport = { kind, message };
    if (err?.stack) report.stack = err.stack.slice(0, 4000);
    const path = window.location.pathname.slice(0, 200);
    if (path.startsWith("/")) report.path = path;
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Hata bildirimi asla uygulamayı bozmamalı.
  }
}
