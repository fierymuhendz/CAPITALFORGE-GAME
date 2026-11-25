"use client";
/**
 * Uygulama bağlamı: oturum (me), dünya kataloğu, dil, tema, canlı bağlantı durumu.
 * Sunucudan gelen veri tek yerde yüklenir; paneller useData ile kendi verilerini çeker.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale, MeDto, NotificationDto, WorldDto } from "@capitalforge/shared";
import { api, ApiError, reportClientError } from "./api";
import { setServerTime } from "./clock";
import { clearDataCache, useData } from "./data";
import { getConnState, onConn, onHello, onNotification, startEvents, stopEvents, type ConnState, emitInvalidate } from "./events";
import { browserLocale, LocaleProvider, setNotifWorld, useT } from "./i18n";
import { ToastProvider, useToast } from "@/ui/Toast";
import { Button, EmptyState } from "@/ui/Basic";

export type Theme = "dark" | "light";

interface AppCtx {
  me: MeDto | null;
  world: WorldDto | null;
  refreshMe: () => void;
  signedOut: () => void;
  setLocale: (l: Locale) => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
  conn: ConnState;
}
const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider yok");
  return c;
}

function Live() {
  const toast = useToast();
  const i = useT();
  useEffect(() => onNotification((n: NotificationDto) => toast({ kind: "info", text: i.notif(n), ms: 7000 })), [toast, i]);
  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLoc] = useState<Locale>("tr");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [conn, setConn] = useState<ConnState>(getConnState());
  const meRes = useData<MeDto>("/auth/me", undefined, ["*"]);
  const worldRes = useData<WorldDto>("/world", undefined, []);
  const me = meRes.data;
  const world = worldRes.data;

  useEffect(() => {
    const s = localStorage.getItem("cf-locale");
    setLoc(s === "tr" || s === "en" ? s : browserLocale());
    const th = localStorage.getItem("cf-theme");
    const next: Theme = th === "light" ? "light" : "dark";
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    const onErr = (e: ErrorEvent) => reportClientError(e.message, e.error instanceof Error ? e.error.stack : undefined);
    const onRej = (e: PromiseRejectionEvent) => { if (!(e.reason instanceof ApiError)) reportClientError(String(e.reason instanceof Error ? e.reason.message : e.reason), e.reason instanceof Error ? e.reason.stack : undefined); };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);

  useEffect(() => { if (me?.account) setLoc(me.account.locale); }, [me?.account?.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { if (me) setServerTime(me.serverTime); }, [me]);
  useEffect(() => { if (world) { setServerTime(world.serverTime); setNotifWorld(world); } }, [world]);
  useEffect(() => { onHello(setServerTime); return onConn(setConn); }, []);

  const loggedIn = !!me?.account;
  useEffect(() => {
    if (loggedIn) startEvents();
    else stopEvents();
    return () => stopEvents();
  }, [loggedIn]);

  const setLocale = useCallback(async (l: Locale) => {
    setLoc(l);
    localStorage.setItem("cf-locale", l);
    if (loggedIn) {
      try { await api.patch("/account/prefs", { locale: l }); } catch { /* yerel dil yine de değişti */ }
      meRes.reload();
    }
  }, [loggedIn, meRes]);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    localStorage.setItem("cf-theme", th);
    document.documentElement.dataset.theme = th;
  }, []);

  const signedOut = useCallback(() => { clearDataCache(); meRes.reload(); }, [meRes]);
  const refreshMe = useCallback(() => { emitInvalidate("*"); meRes.reload(); }, [meRes]);

  const value = useMemo<AppCtx>(() => ({ me, world, refreshMe, signedOut, setLocale, theme, setTheme, conn }), [me, world, refreshMe, signedOut, setLocale, theme, setTheme, conn]);
  const lv = useMemo(() => ({ locale, setLocale: (l: Locale) => void setLocale(l) }), [locale, setLocale]);

  return (
    <LocaleProvider value={lv}>
      <ToastProvider closeLabel={locale === "tr" ? "Kapat" : "Close"}>
        <Ctx.Provider value={value}>
          <Live />
          <Boot meError={meRes.error} worldError={worldRes.error} ready={!!me && !!world} retry={() => { meRes.reload(); worldRes.reload(); }}>{children}</Boot>
        </Ctx.Provider>
      </ToastProvider>
    </LocaleProvider>
  );
}

function Boot({ ready, meError, worldError, retry, children }: { ready: boolean; meError: ApiError | null; worldError: ApiError | null; retry: () => void; children: ReactNode }) {
  const { t } = useT();
  if (ready) return <>{children}</>;
  if (meError || worldError) {
    return (
      <main className="page"><div className="auth-card"><EmptyState icon="x" title={t("boot.failedTitle")} text={t("boot.failedText")} action={<Button variant="primary" onClick={retry}>{t("common.retry")}</Button>} /></div></main>
    );
  }
  return <main className="page" aria-busy="true"><div className="auth-card"><div className="skel" style={{ height: 160 }} /></div></main>;
}
