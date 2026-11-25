"use client";
import { useEffect } from "react";

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
