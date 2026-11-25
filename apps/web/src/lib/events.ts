/**
 * Canlı olaylar (WebSocket). Üretimde /ws/events, yerelde NEXT_PUBLIC_GAME_SERVER_URL + /events.
 * Tek bağlantı; kopunca üstel bekleme ile yeniden bağlanır. Her 30 sn tüm veriyi yenileme sinyali verir.
 */
import type { NotificationDto, ServerEvent } from "@capitalforge/shared";

export type ConnState = "idle" | "connecting" | "open" | "closed";
type InvalidateFn = (topics: string[] | "*") => void;

const invalidators = new Set<InvalidateFn>();
const connListeners = new Set<(s: ConnState) => void>();
const notifListeners = new Set<(n: NotificationDto) => void>();
let state: ConnState = "idle";
let ws: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let attempt = 0;
let wanted = false;
let helloListener: ((iso: string) => void) | null = null;

function setState(s: ConnState): void {
  state = s;
  connListeners.forEach((f) => f(s));
}

export const getConnState = (): ConnState => state;
export function onInvalidate(f: InvalidateFn): () => void { invalidators.add(f); return () => { invalidators.delete(f); }; }
export function onConn(f: (s: ConnState) => void): () => void { connListeners.add(f); return () => { connListeners.delete(f); }; }
export function onNotification(f: (n: NotificationDto) => void): () => void { notifListeners.add(f); return () => { notifListeners.delete(f); }; }
export function onHello(f: (iso: string) => void): void { helloListener = f; }
export function emitInvalidate(topics: string[] | "*" = "*"): void { invalidators.forEach((f) => f(topics)); }

function wsUrl(): string {
  const base = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  const origin = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  if (!base) return `${origin}/ws/events`;
  const b = base.replace(/\/$/, "");
  // Göreli adres ("/ws") eski tarayıcılarda WebSocket'e verilemez; mutlak adrese çevrilir.
  return b.startsWith("/") ? `${origin}${b}/events` : `${b}/events`;
}

function connect(): void {
  if (!wanted || typeof window === "undefined") return;
  setState("connecting");
  let sock: WebSocket;
  try { sock = new WebSocket(wsUrl()); } catch { schedule(); return; }
  ws = sock;
  sock.onopen = () => { attempt = 0; setState("open"); emitInvalidate("*"); };
  sock.onmessage = (m) => {
    let ev: ServerEvent;
    try { ev = JSON.parse(String(m.data)) as ServerEvent; } catch { return; }
    if (ev.type === "hello") helloListener?.(ev.serverTime);
    else if (ev.type === "invalidate") emitInvalidate(ev.topics);
    else if (ev.type === "world") emitInvalidate(ev.topics);
    else if (ev.type === "notification") { notifListeners.forEach((f) => f(ev.notification)); emitInvalidate(["notifications", "company"]); }
  };
  sock.onclose = () => { if (ws === sock) { ws = null; setState("closed"); schedule(); } };
  sock.onerror = () => { try { sock.close(); } catch { /* yoksay */ } };
}

function schedule(): void {
  if (!wanted || timer) return;
  const wait = Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4));
  timer = setTimeout(() => { timer = null; connect(); }, wait);
}

export function startEvents(): void {
  if (wanted) return;
  wanted = true;
  connect();
  poll = setInterval(() => emitInvalidate("*"), 30_000);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
}
function onVis(): void {
  if (document.visibilityState === "visible") { emitInvalidate("*"); if (state === "closed" && !timer) schedule(); }
}
export function stopEvents(): void {
  wanted = false;
  if (timer) clearTimeout(timer);
  if (poll) clearInterval(poll);
  timer = null; poll = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
  ws?.close(); ws = null;
  setState("idle");
}
