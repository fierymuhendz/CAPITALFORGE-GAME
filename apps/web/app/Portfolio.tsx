"use client";

import { formatMoney } from "@capitalforge/economy";
import { PRODUCT_IDS } from "@capitalforge/shared";
import { formatQuantity, productLabel } from "../lib/labels";
import { useGame } from "./GameProvider";

export function Portfolio() {
  const { portfolio } = useGame();
  const qty = new Map(portfolio?.inventory.map((i) => [i.productId, i.quantity]));
  return (
    <section aria-label="Portföy" className="rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">Bakiye</h2>
      <p data-testid="balance" className="text-2xl font-bold tabular-nums">
        {portfolio ? formatMoney(BigInt(portfolio.balance)) : <span className="inline-block h-8 w-32 animate-pulse rounded bg-slate-800 align-middle" aria-label="Yükleniyor" />}
      </p>
      <h2 className="mt-4 text-sm font-semibold tracking-wide text-slate-300">Envanter</h2>
      {portfolio && PRODUCT_IDS.every((id) => (qty.get(id) ?? "0") === "0") && (
        <p className="mt-1 text-sm text-slate-400" data-testid="inventory-empty">
          Envanteriniz boş. Piyasadan ürün alın veya üretim başlatın.
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {PRODUCT_IDS.map((id) => (
          <li key={id} className="flex justify-between">
            <span>{productLabel(id)}</span>
            <span data-testid={`inv-${id}`} className="tabular-nums">{formatQuantity(qty.get(id) ?? "0")} adet</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
