"use client";

import { useEffect } from "react";
import { reportError } from "../lib/reportError";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportError("react", error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6" role="alert">
      <h1 className="text-2xl font-bold tracking-tight">Bir şeyler ters gitti</h1>
      <p className="text-sm text-slate-300">Beklenmeyen bir hata oluştu. Yeniden deneyebilirsiniz.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-emerald-600 p-3 font-semibold outline-none hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-white"
      >
        Yeniden dene
      </button>
    </main>
  );
}
