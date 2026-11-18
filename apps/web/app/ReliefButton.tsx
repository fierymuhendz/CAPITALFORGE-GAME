"use client";

import { formatMoney } from "@capitalforge/economy";
import { useGame } from "./GameProvider";
import { Feedback, useAction } from "./useAction";

export function ReliefButton() {
  const { company, catalog } = useGame();
  const { run, busy, message, connected } = useAction("claimRelief");
  if (!company?.reliefAvailable && !message) return null;
  return (
    <section aria-label="Asgari ödenek" className="flex flex-col gap-2 rounded-lg bg-amber-950 p-4">
      {company?.reliefAvailable && (
        <>
          <p className="text-sm text-amber-100">
            Bakiyeniz tükendi. Asgari ödenek alabilirsiniz
            {catalog ? `: ${formatMoney(BigInt(catalog.reliefAmount))}` : "."}
          </p>
          <button
            type="button"
            disabled={busy || !connected}
            onClick={() => void run({}, (r) => `Ödenek alındı: ${formatMoney(BigInt(r.amount))}.`)}
            className="rounded bg-amber-600 p-3 font-semibold text-black hover:bg-amber-500 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {busy ? "Gönderiliyor…" : "Ödenek al"}
          </button>
        </>
      )}
      <Feedback message={message} testId="relief-message" />
    </section>
  );
}
