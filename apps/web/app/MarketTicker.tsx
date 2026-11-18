"use client";

import { formatMoney } from "@capitalforge/economy";
import { PRODUCT_IDS } from "@capitalforge/shared";
import { productLabel } from "../lib/labels";
import { useGame, type ConnectionStatus } from "./GameProvider";

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  bağlı: "bg-emerald-900 text-emerald-200",
  bağlanıyor: "bg-amber-900 text-amber-200",
  "yeniden bağlanıyor": "bg-red-900 text-red-200",
};

export function ConnectionBadge() {
  const { status } = useGame();
  return (
    <span role="status" className={`rounded px-2 py-1 text-xs ${STATUS_STYLE[status]}`}>
      {status === "bağlı" ? "● Bağlı" : status === "bağlanıyor" ? "◌ Bağlanıyor…" : "⚠ Bağlantı koptu, yeniden bağlanıyor…"}
    </span>
  );
}

/** Fiyatlar sunucudan gelir; istemci hesap yapmaz, yalnızca gösterir ve yönü karşılaştırır. */
export function MarketTicker() {
  const { quotes } = useGame();
  return (
    <section aria-label="Piyasa fiyatları">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PRODUCT_IDS.map((id) => {
          const q = quotes[id];
          const dir = q?.prev == null ? 0 : BigInt(q.price) > BigInt(q.prev) ? 1 : BigInt(q.price) < BigInt(q.prev) ? -1 : 0;
          return (
            <li key={id} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
              <span>{productLabel(id)}</span>
              <span className="tabular-nums">
                {q ? formatMoney(BigInt(q.price)) : "…"}{" "}
                <span className={dir > 0 ? "text-emerald-400" : dir < 0 ? "text-red-400" : "text-slate-500"}>
                  {dir > 0 ? "▲ yükseldi" : dir < 0 ? "▼ düştü" : "–"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
