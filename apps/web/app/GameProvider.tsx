"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Client, type Room } from "colyseus.js";
import {
  ActionResultSchema,
  CatalogSchema,
  CityResponseSchema,
  CompanyViewSchema,
  JobCompletedSchema,
  MSG,
  OrderResultSchema,
  PortfolioSchema,
  ROOMS,
  type ActionResult,
  type Catalog,
  type CityResponse,
  type CompanyView,
  type JobCompleted,
  type OrderResult,
  type PlaceOrder,
  type Portfolio,
} from "@capitalforge/shared";

export type ConnectionStatus = "bağlanıyor" | "bağlı" | "yeniden bağlanıyor";

export interface ProductQuote {
  /** Kuruş cinsinden fiyat (sunucudan, string). */
  price: string;
  /** Bir önceki gösterilen fiyat, yön oku için. */
  prev: string | null;
  tick: number;
}

/** Ticaret dışı niyetler: istemci yalnızca niyeti gönderir, idempotencyKey'i sendAction ekler. */
export type ActionType = "foundCompany" | "buyFacility" | "startProduction" | "claimRelief";

export type CompletionNotice = JobCompleted;

interface GameContextValue {
  status: ConnectionStatus;
  quotes: Record<string, ProductQuote>;
  portfolio: Portfolio | null;
  sendOrder: (order: PlaceOrder) => Promise<OrderResult>;
  /**
   * Ticaret dışı niyet gönderir. Yanıt idempotencyKey ile eşleşir; yeniden denemede
   * çağıran aynı anahtarı verir (verilmezse yeni anahtar üretilir).
   */
  sendAction: (type: ActionType, payload: Record<string, unknown>, idempotencyKey: string) => Promise<ActionResult>;
  company: CompanyView | null;
  /** Sunucu oyun saati (state.clockTick, ~500 ms'de bir yansıtılır). */
  clockTick: number | null;
  catalog: Catalog | null;
  city: CityResponse | null;
  refreshCity: () => void;
  completions: CompletionNotice[];
  dismissCompletion: (jobId: string) => void;
  /** HTTP 401 gibi durumlarda oturumu sonlandırır. */
  sessionExpired: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("GameProvider dışında kullanılamaz");
  return ctx;
}

/** Fiyat mesajları bu aralıkta toplanıp tek render ile yansıtılır. */
const FLUSH_MS = 500;
const ORDER_TIMEOUT_MS = 8000;
const AUTH_ERROR_CODES = new Set([401, 4002]);

interface ProductSchemaLike {
  price: string;
  tick: number;
}
interface StateLike {
  clockTick: number;
  products: { forEach(cb: (value: ProductSchemaLike, key: string) => void): void };
}

export function GameProvider({
  token,
  onUnauthorized,
  children,
}: {
  token: string;
  onUnauthorized: () => void;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<ConnectionStatus>("bağlanıyor");
  const [quotes, setQuotes] = useState<Record<string, ProductQuote>>({});
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [company, setCompany] = useState<CompanyView | null>(null);
  const [clockTick, setClockTick] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [city, setCity] = useState<CityResponse | null>(null);
  const [completions, setCompletions] = useState<CompletionNotice[]>([]);
  const roomRef = useRef<Room | null>(null);
  const pending = useRef(new Map<string, (r: OrderResult) => void>());
  const pendingActions = useRef(new Map<string, (r: ActionResult) => void>());
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    // Ham durum burada birikir, render yalnızca flush'ta olur.
    const latest = new Map<string, ProductSchemaLike>();
    let dirty = false;
    let latestClock: number | null = null;

    const url = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "ws://localhost:2567";
    const client = new Client(url);

    const flush = () => {
      if (latestClock !== null) setClockTick((old) => (old === latestClock ? old : latestClock));
      if (!dirty) return;
      dirty = false;
      setQuotes((old) => {
        const next: Record<string, ProductQuote> = {};
        latest.forEach((p, id) => {
          const before = old[id];
          next[id] =
            before && before.tick === p.tick
              ? before
              : { price: p.price, prev: before ? before.price : null, tick: p.tick };
        });
        return next;
      });
    };

    const connect = async () => {
      if (disposed) return;
      try {
        const room = await client.joinOrCreate(ROOMS.market, { token });
        if (disposed) {
          void room.leave();
          return;
        }
        attempt = 0;
        roomRef.current = room;
        setStatus("bağlı");

        room.onStateChange((state) => {
          const st = state as unknown as StateLike;
          latestClock = st.clockTick;
          st.products.forEach((p, id) => {
            latest.set(id, { price: p.price, tick: p.tick });
          });
          dirty = true;
        });
        room.onMessage(MSG.portfolio, (raw: unknown) => {
          const parsed = PortfolioSchema.safeParse(raw);
          if (parsed.success) setPortfolio(parsed.data);
        });
        room.onMessage(MSG.company, (raw: unknown) => {
          const parsed = CompanyViewSchema.safeParse(raw);
          if (parsed.success) setCompany(parsed.data);
        });
        room.onMessage(MSG.jobCompleted, (raw: unknown) => {
          const parsed = JobCompletedSchema.safeParse(raw);
          if (parsed.success) setCompletions((old) => [...old.filter((c) => c.jobId !== parsed.data.jobId), parsed.data].slice(-3));
        });
        room.onMessage(MSG.actionResult, (raw: unknown) => {
          const parsed = ActionResultSchema.safeParse(raw);
          if (!parsed.success) return;
          const key = parsed.data.idempotencyKey;
          if (!key) return;
          const resolve = pendingActions.current.get(key);
          if (resolve) {
            pendingActions.current.delete(key);
            resolve(parsed.data);
          }
        });
        room.onMessage(MSG.orderResult, (raw: unknown) => {
          const parsed = OrderResultSchema.safeParse(raw);
          if (!parsed.success) return;
          const key = parsed.data.idempotencyKey;
          if (!key) return;
          const resolve = pending.current.get(key);
          if (resolve) {
            pending.current.delete(key);
            resolve(parsed.data);
          }
        });
        room.onLeave((code) => {
          if (roomRef.current === room) roomRef.current = null;
          if (disposed) return;
          if (AUTH_ERROR_CODES.has(code)) {
            unauthorizedRef.current();
            return;
          }
          scheduleReconnect();
        });
      } catch (err) {
        if (disposed) return;
        const code = (err as { code?: number } | null)?.code;
        if (typeof code === "number" && AUTH_ERROR_CODES.has(code)) {
          unauthorizedRef.current();
          return;
        }
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      setStatus("yeniden bağlanıyor");
      attempt += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    flushTimer = setInterval(flush, FLUSH_MS);
    void connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (flushTimer) clearInterval(flushTimer);
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.leave();
    };
  }, [token]);

  const sendOrder = useCallback((order: PlaceOrder) => {
    return new Promise<OrderResult>((resolve, reject) => {
      const room = roomRef.current;
      if (!room) {
        reject(new Error("NOT_CONNECTED"));
        return;
      }
      const timer = setTimeout(() => {
        pending.current.delete(order.idempotencyKey);
        reject(new Error("TIMEOUT"));
      }, ORDER_TIMEOUT_MS);
      pending.current.set(order.idempotencyKey, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      room.send(MSG.placeOrder, order);
    });
  }, []);

  const sendAction = useCallback(
    (type: ActionType, payload: Record<string, unknown>, idempotencyKey: string) => {
      return new Promise<ActionResult>((resolve, reject) => {
        const room = roomRef.current;
        if (!room) {
          reject(new Error("NOT_CONNECTED"));
          return;
        }
        const timer = setTimeout(() => {
          pendingActions.current.delete(idempotencyKey);
          reject(new Error("TIMEOUT"));
        }, ORDER_TIMEOUT_MS);
        pendingActions.current.set(idempotencyKey, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        room.send(MSG[type], { ...payload, idempotencyKey });
      });
    },
    [],
  );

  const sessionExpired = useCallback(() => unauthorizedRef.current(), []);

  const dismissCompletion = useCallback(
    (jobId: string) => setCompletions((old) => old.filter((c) => c.jobId !== jobId)),
    [],
  );

  const authFetch = useCallback(
    async (path: string): Promise<unknown> => {
      const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        unauthorizedRef.current();
        return null;
      }
      return res.ok ? ((await res.json()) as unknown) : null;
    },
    [token],
  );

  const refreshCity = useCallback(() => {
    void authFetch("/api/city?cityId=merkez")
      .then((raw) => {
        const parsed = CityResponseSchema.safeParse(raw);
        if (parsed.success) setCity(parsed.data);
      })
      .catch(() => undefined);
  }, [authFetch]);

  // Katalog (oyuncuya özel fiyatlar) şirket/tesis sayısı değişince yeniden alınır; istemci fiyat hesaplamaz.
  const facilityCount = company?.facilities.length ?? 0;
  const hasCompany = company?.company != null;
  useEffect(() => {
    let cancelled = false;
    void authFetch("/api/catalog")
      .then((raw) => {
        const parsed = CatalogSchema.safeParse(raw);
        if (parsed.success && !cancelled) setCatalog(parsed.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authFetch, facilityCount, hasCompany]);

  // Bağlantı yeniden kurulunca (kaçırılmış mesajlar için) şirket görünümü HTTP ile tazelenir.
  useEffect(() => {
    if (status !== "bağlı") return;
    void authFetch("/api/company")
      .then((raw) => {
        const parsed = CompanyViewSchema.safeParse(raw);
        if (parsed.success) setCompany(parsed.data);
      })
      .catch(() => undefined);
  }, [authFetch, status]);

  useEffect(() => {
    refreshCity();
  }, [refreshCity, facilityCount]);

  const value = useMemo(
    () => ({
      status,
      quotes,
      portfolio,
      sendOrder,
      sendAction,
      company,
      clockTick,
      catalog,
      city,
      refreshCity,
      completions,
      dismissCompletion,
      sessionExpired,
    }),
    [status, quotes, portfolio, sendOrder, sendAction, company, clockTick, catalog, city, refreshCity, completions, dismissCompletion, sessionExpired],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
