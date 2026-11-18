"use client";

import { useRef, useState, type FormEvent } from "react";
import { formatMoney } from "@capitalforge/economy";
import { PRODUCT_IDS, PlaceOrderSchema, type OrderResult, type PlaceOrder } from "@capitalforge/shared";
import { ORDER_ERROR_TEXT, RETRYABLE, productLabel } from "../lib/labels";
import { useGame } from "./GameProvider";

type Side = "buy" | "sell";

export function OrderForm({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { sendOrder, status } = useGame();
  const [side, setSide] = useState<Side>("buy");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /** Yeniden denenebilir başarısızlıktan sonra aynı emir aynı anahtarla gider. */
  const retry = useRef<{ sig: string; key: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const quantity = Number(qty);
    const sig = `${side}:${selected}:${quantity}`;
    const key = retry.current?.sig === sig ? retry.current.key : crypto.randomUUID();
    const parsed = PlaceOrderSchema.safeParse({ side, productId: selected, quantity, idempotencyKey: key });
    if (!parsed.success) {
      setMessage({ kind: "err", text: ORDER_ERROR_TEXT.INVALID });
      return;
    }
    const order: PlaceOrder = parsed.data;
    setBusy(true);
    try {
      const result: OrderResult = await sendOrder(order);
      if (result.ok) {
        retry.current = null;
        setMessage({
          kind: "ok",
          text: `${result.side === "buy" ? "Alındı" : "Satıldı"}: ${result.quantity} ${productLabel(result.productId)}, birim ${formatMoney(BigInt(result.unitPrice))}, toplam ${formatMoney(BigInt(result.gross))}, vergi ${formatMoney(BigInt(result.tax))}.`,
        });
      } else {
        retry.current = RETRYABLE.has(result.error) ? { sig, key } : null;
        setMessage({ kind: "err", text: ORDER_ERROR_TEXT[result.error] });
      }
    } catch (err) {
      // Yanıt gelmedi: emir işlenmiş olabilir, aynı anahtarla yeniden denenir.
      retry.current = { sig, key };
      const offline = err instanceof Error && err.message === "NOT_CONNECTED";
      setMessage({
        kind: "err",
        text: offline ? "Sunucuya bağlı değilsiniz." : "Yanıt alınamadı. Tekrar gönderirseniz aynı emir yinelenmez.",
      });
    } finally {
      setBusy(false);
    }
  }

  const focus = "focus-visible:ring-2 focus-visible:ring-white outline-none";
  return (
    <form onSubmit={submit} aria-label="Emir ver" className="flex flex-col gap-3 rounded-lg bg-slate-900 p-4">
      <h2 className="text-sm text-slate-400">Emir</h2>
      <label className="flex flex-col gap-1 text-sm">
        Ürün
        <select value={selected} onChange={(e) => onSelect(e.target.value)} className={`rounded bg-slate-800 p-3 ${focus}`}>
          {PRODUCT_IDS.map((id) => (
            <option key={id} value={id}>{productLabel(id)}</option>
          ))}
        </select>
      </label>
      <div role="group" aria-label="Yön" className="grid grid-cols-2 gap-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`rounded p-3 font-semibold ${focus} ${side === s ? "bg-emerald-700" : "bg-slate-800"}`}
          >
            {s === "buy" ? "Al" : "Sat"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Miktar
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={`rounded bg-slate-800 p-3 ${focus}`}
        />
      </label>
      <button
        type="submit"
        disabled={busy || status !== "bağlı"}
        className={`rounded bg-emerald-600 p-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 ${focus}`}
      >
        {busy ? "Gönderiliyor…" : side === "buy" ? "Satın al" : "Sat"}
      </button>
      <p role="status" aria-live="polite" data-testid="order-message" className={`min-h-5 text-sm ${message?.kind === "err" ? "text-red-400" : "text-emerald-400"}`}>
        {message ? `${message.kind === "err" ? "⚠ " : "✓ "}${message.text}` : ""}
      </p>
    </form>
  );
}
