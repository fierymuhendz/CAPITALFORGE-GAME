"use client";

import { useCallback, useRef, useState } from "react";
import type { ActionResult } from "@capitalforge/shared";
import { ACTION_ERROR_TEXT, ACTION_RETRYABLE } from "../lib/labels";
import { useGame, type ActionType } from "./GameProvider";

export interface ActionMessage {
  kind: "ok" | "err";
  text: string;
}

/**
 * Tek bir niyet türü için gönderim durumu. Yanıt gelmediyse veya hata yeniden denenebilirse
 * aynı niyet aynı idempotencyKey ile gider; niyet değişirse yeni anahtar üretilir.
 */
export function useAction(type: ActionType) {
  const { sendAction, status } = useGame();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const retry = useRef<{ sig: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (payload: Record<string, unknown>, okText: (r: Extract<ActionResult, { ok: true }>) => string): Promise<ActionResult | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setMessage(null);
      const sig = JSON.stringify(payload);
      const key = retry.current?.sig === sig ? retry.current.key : crypto.randomUUID();
      try {
        const result = await sendAction(type, payload, key);
        if (result.ok) {
          retry.current = null;
          setMessage({ kind: "ok", text: okText(result) });
        } else {
          retry.current = ACTION_RETRYABLE.has(result.error) ? { sig, key } : null;
          setMessage({ kind: "err", text: ACTION_ERROR_TEXT[result.error] });
        }
        return result;
      } catch (err) {
        retry.current = { sig, key };
        const offline = err instanceof Error && err.message === "NOT_CONNECTED";
        setMessage({
          kind: "err",
          text: offline ? "Sunucuya bağlı değilsiniz." : "Yanıt alınamadı. Tekrar gönderirseniz işlem yinelenmez.",
        });
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [sendAction, type],
  );

  return { run, busy, message, setMessage, connected: status === "bağlı" };
}

export function Feedback({ message, testId }: { message: ActionMessage | null; testId?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`min-h-5 text-sm ${message?.kind === "err" ? "text-red-400" : "text-emerald-400"}`}
    >
      {message ? `${message.kind === "err" ? "⚠ " : "✓ "}${message.text}` : ""}
    </p>
  );
}
