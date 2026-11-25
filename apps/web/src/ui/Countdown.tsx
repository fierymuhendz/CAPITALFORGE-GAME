"use client";
import { useEffect, useState } from "react";
import { fmtDuration, serverNow } from "@/lib/clock";
import { ProgressBar } from "./Basic";

const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function sub(f: () => void): () => void {
  subs.add(f);
  if (!timer) timer = setInterval(() => subs.forEach((g) => g()), 1000);
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
/** Sunucu saatiyle her saniye güncellenen "şimdi" (ms). Tüm sayaçlar tek zamanlayıcıyı paylaşır. */
export function useServerNow(): number {
  const [n, setN] = useState(() => serverNow());
  useEffect(() => { setN(serverNow()); return sub(() => setN(serverNow())); }, []);
  return n;
}

export function Countdown({ until, doneText }: { until: string; doneText?: string }) {
  const now = useServerNow();
  const left = Date.parse(until) - now;
  return <span className="num" aria-live="off">{left <= 0 ? doneText ?? "00:00" : fmtDuration(left)}</span>;
}

export function TimeProgress({ from, to, steel }: { from: string; to: string; steel?: boolean }) {
  const now = useServerNow();
  const a = Date.parse(from), b = Date.parse(to);
  return <ProgressBar steel={steel} value={b > a ? ((now - a) / (b - a)) * 100 : 100} />;
}
