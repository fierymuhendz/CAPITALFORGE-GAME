"use client";

import { useEffect } from "react";
import { productLabel, recipeLabel } from "../lib/labels";
import { useGame } from "./GameProvider";

const TOAST_MS = 6000;

export function CompletionToasts() {
  const { completions, dismissCompletion } = useGame();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4">
      {completions.map((c) => (
        <Toast key={c.jobId} onDone={() => dismissCompletion(c.jobId)}>
          ✓ {recipeLabel(c.recipeId)} tamamlandı: {c.outputQty} {productLabel(c.outputProductId)} envantere eklendi.
        </Toast>
      ))}
    </div>
  );
}

function Toast({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div data-testid="job-toast" className="pointer-events-auto flex items-center gap-3 rounded-lg bg-emerald-900 px-4 py-3 text-sm text-emerald-100 shadow-lg">
      <span>{children}</span>
      <button type="button" onClick={onDone} aria-label="Bildirimi kapat" className="rounded px-2 py-1 outline-none hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-white">
        ✕
      </button>
    </div>
  );
}
