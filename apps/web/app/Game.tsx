"use client";

import { useEffect, useState } from "react";
import { PRODUCT_IDS } from "@capitalforge/shared";
import { clearSession, loadSession, logoutRequest, type StoredSession } from "../lib/session";
import { CityGrid } from "./CityGrid";
import { CompanyPanel } from "./CompanyPanel";
import { CompletionToasts } from "./CompletionToasts";
import { FacilityList } from "./FacilityList";
import { GameProvider } from "./GameProvider";
import { LoginForm } from "./LoginForm";
import { MarketTicker, ConnectionBadge } from "./MarketTicker";
import { OrderForm } from "./OrderForm";
import { Portfolio } from "./Portfolio";
import { PriceChart } from "./PriceChart";
import { ProductionForm } from "./ProductionForm";
import { ReliefButton } from "./ReliefButton";

export function Game() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [selected, setSelected] = useState<string>(PRODUCT_IDS[0]);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  /** Yerel oturumu siler ve giriş ekranına döner (sunucu çağrısı yapmaz). */
  function logout(message?: string) {
    clearSession();
    setSession(null);
    setConfirmOpen(false);
    setLoggingOut(false);
    setNotice(message);
  }

  /** Önce sunucuda iptal edilir; hata olsa bile yerel oturum silinir. */
  async function confirmLogout(all: boolean) {
    if (!session) return;
    setLoggingOut(true);
    await logoutRequest(session.token, all);
    logout();
  }

  if (!ready) {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4" aria-busy="true" aria-label="Yükleniyor">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-800" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-900" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-900" />
      </main>
    );
  }
  if (!session) return <LoginForm notice={notice} onLogin={(s) => { setNotice(undefined); setSession(s); }} />;

  return (
    <GameProvider token={session.token} onUnauthorized={() => logout("Oturumunuz sona erdi, yeniden giriş yapın.")}>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">CapitalForge</h1>
          <div className="flex items-center gap-3">
            <ConnectionBadge />
            <span className="text-sm text-slate-300">Oyuncu: {session.username}</span>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="rounded bg-slate-800 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Çıkış
            </button>
          </div>
        </header>
        {confirmOpen && (
          <div
            role="alertdialog"
            aria-labelledby="logout-title"
            aria-describedby="logout-desc"
            className="flex flex-col gap-3 rounded-lg border border-amber-700 bg-slate-900 p-4"
          >
            <h2 id="logout-title" className="font-semibold">Çıkış yapılsın mı?</h2>
            <p id="logout-desc" className="text-sm text-slate-300">
              ⚠ Misafir hesabına tekrar giremezsin. Çıkış yaparsan bu hesaba, şirketine ve envanterine bir daha erişemezsin.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                disabled={loggingOut}
                onClick={() => setConfirmOpen(false)}
                onKeyDown={(e) => { if (e.key === "Escape") setConfirmOpen(false); }}
                className="rounded bg-slate-800 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void confirmLogout(false)}
                className="rounded bg-red-700 px-3 py-2 text-sm font-semibold outline-none hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              >
                {loggingOut ? "Çıkılıyor…" : "Çıkış yap"}
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void confirmLogout(true)}
                className="rounded bg-red-900 px-3 py-2 text-sm font-semibold outline-none hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              >
                Tüm cihazlardan çık
              </button>
            </div>
          </div>
        )}
        <MarketTicker />
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <PriceChart productId={selected} />
            <OrderForm selected={selected} onSelect={setSelected} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Portfolio />
            <ReliefButton />
            <CompanyPanel />
            <FacilityList />
            <ProductionForm />
          </div>
        </div>
        <CityGrid />
        <CompletionToasts />
      </main>
    </GameProvider>
  );
}
