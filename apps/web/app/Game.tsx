"use client";

import { useEffect, useState } from "react";
import { PRODUCT_IDS } from "@capitalforge/shared";
import { clearSession, loadSession, type StoredSession } from "../lib/session";
import { GameProvider } from "./GameProvider";
import { LoginForm } from "./LoginForm";
import { MarketTicker, ConnectionBadge } from "./MarketTicker";
import { OrderForm } from "./OrderForm";
import { Portfolio } from "./Portfolio";
import { PriceChart } from "./PriceChart";

export function Game() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [selected, setSelected] = useState<string>(PRODUCT_IDS[0]);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  function logout(message?: string) {
    clearSession();
    setSession(null);
    setNotice(message);
  }

  if (!ready) return null;
  if (!session) return <LoginForm notice={notice} onLogin={(s) => { setNotice(undefined); setSession(s); }} />;

  return (
    <GameProvider token={session.token} onUnauthorized={() => logout("Oturumunuz sona erdi, yeniden giriş yapın.")}>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">CapitalForge</h1>
          <div className="flex items-center gap-3">
            <ConnectionBadge />
            <span className="text-sm text-slate-400">{session.username}</span>
            <button
              type="button"
              onClick={() => logout()}
              className="rounded bg-slate-800 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Çıkış
            </button>
          </div>
        </header>
        <MarketTicker />
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <PriceChart productId={selected} />
          <div className="flex flex-col gap-4">
            <Portfolio />
            <OrderForm selected={selected} onSelect={setSelected} />
          </div>
        </div>
      </main>
    </GameProvider>
  );
}
