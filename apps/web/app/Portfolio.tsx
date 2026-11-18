"use client";

import { formatMoney } from "@capitalforge/economy";
import { PRODUCT_IDS } from "@capitalforge/shared";
import { productLabel } from "../lib/labels";
import { useGame } from "./GameProvider";

export function Portfolio() {
  const { portfolio } = useGame();
  const qty = new Map(portfolio?.inventory.map((i) => [i.productId, i.quantity]));
  return (
    <section aria-label="Portföy" className="rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm text-slate-400">Bakiye</h2>
      <p data-testid="balance" className="text-2xl font-bold tabular-nums">
        {portfolio ? formatMoney(BigInt(portfolio.balance)) : "…"}
      </p>
      <h2 className="mt-3 text-sm text-slate-400">Envanter</h2>
      <ul className="mt-1 space-y-1">
        {PRODUCT_IDS.map((id) => (
          <li key={id} className="flex justify-between">
            <span>{productLabel(id)}</span>
            <span data-testid={`inv-${id}`} className="tabular-nums">{qty.get(id) ?? "0"} adet</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
