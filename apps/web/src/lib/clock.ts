/** Sunucu saati farkı: now = Date.now() + offset. */
let offset = 0;
export function setServerTime(serverIso: string): void {
  const t = Date.parse(serverIso);
  if (Number.isFinite(t)) offset = t - Date.now();
}
export const serverOffsetMs = (): number => offset;
export const serverNow = (): number => Date.now() + offset;

/** ms → "1:02:05" veya "02:05" */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
