"use client";
import { useEffect, useState } from "react";

/**
 * Ekran klavyesi ve gerçek görünür yükseklik: `--app-h` (visualViewport) ve klavye açıkken `html[data-kbd]`.
 * interactive-widget=resizes-content destekleyen tarayıcılarda dvh zaten küçülür; iOS için visualViewport yedeği.
 */
export function ViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const de = document.documentElement;
    let base = window.innerHeight;
    const f = () => {
      base = Math.max(base, window.innerHeight);
      const kbd = base - vv.height > 140;
      if (kbd) de.dataset.kbd = "1"; else delete de.dataset.kbd;
      de.style.setProperty("--app-h", kbd ? `${Math.round(vv.height)}px` : "100dvh");
    };
    f();
    vv.addEventListener("resize", f);
    window.addEventListener("orientationchange", () => { base = window.innerHeight; f(); });
    return () => { vv.removeEventListener("resize", f); delete de.dataset.kbd; de.style.removeProperty("--app-h"); };
  }, []);
  return null;
}

/** Dar ekran (telefon/dikey tablet): ayrıntılar tam ekran Sheet, geniş ekranda sağ sütun. İlk boyamada false (sunucu çıktısıyla uyumlu). */
export function useNarrow(max = 980): boolean {
  const [n, setN] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(`(max-width: ${max}px)`);
    const f = () => setN(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [max]);
  return n;
}
