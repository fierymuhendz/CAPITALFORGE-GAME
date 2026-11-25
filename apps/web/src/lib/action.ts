"use client";
import { useCallback, useRef, useState } from "react";
import { useToast } from "@/ui/Toast";
import { useT } from "./i18n";
import { emitInvalidate } from "./events";

/** Mutasyon çalıştırıcı: bekleme durumu, hata/başarı bildirimi, sonrasında veriyi yenile. */
export function useAction() {
  const toast = useToast();
  const i = useT();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts?: { ok?: string; silent?: boolean }): Promise<T | undefined> => {
      if (lock.current) return undefined;
      lock.current = true;
      setBusy(true);
      try {
        const r = await fn();
        if (opts?.ok) toast({ kind: "good", text: i.t(opts.ok) });
        emitInvalidate("*");
        return r;
      } catch (e) {
        if (!opts?.silent) toast({ kind: "bad", text: i.err(e) });
        return undefined;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [toast, i],
  );
  return { run, busy };
}
