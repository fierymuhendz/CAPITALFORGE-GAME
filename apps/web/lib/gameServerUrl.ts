export interface LocationLike {
  protocol: string;
  host: string;
}

const DEFAULT_URL = "ws://localhost:2567";

/**
 * Oyun sunucusu WebSocket adresini çözer.
 * - boş: yerel geliştirme adresi
 * - "/ws" gibi göreli yol: sayfanın kökenine göre wss:// veya ws://
 * - tam URL: aynen
 */
export function resolveGameServerUrl(configured: string | undefined, location: LocationLike | undefined): string {
  const value = configured?.trim();
  if (!value) return DEFAULT_URL;
  if (!value.startsWith("/")) return value;
  if (!location) return DEFAULT_URL;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${value}`;
}

/** Tarayıcıda çalışır; NEXT_PUBLIC_ değişkeni derleme zamanında gömülür. */
export function gameServerUrl(): string {
  return resolveGameServerUrl(
    process.env.NEXT_PUBLIC_GAME_SERVER_URL,
    typeof window === "undefined" ? undefined : window.location,
  );
}
