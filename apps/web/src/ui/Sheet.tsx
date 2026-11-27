"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Modal: telefonda alt sayfa, masaüstünde ortada pencere. Gövde kayar; `footer` (eylem düğmeleri) hep görünür kalır, güvenli alanı gözetir. */
export function Sheet({ open, onClose, title, closeLabel, children, footer, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  const hid = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // odak: açılınca içeri, kapanınca tetikleyiciye; Escape kapatır; Tab sayfa içinde döner (yalnızca `open` değişince çalışır)
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => {
      // iç içe Sheet'te yalnızca en üstteki tepki verir
      const all = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (all[all.length - 1] !== ref.current) return;
      if (e.key === "Escape") { closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0]!, last = f[f.length - 1]!, at = document.activeElement;
      if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("keydown", k); (prev.current as HTMLElement | null)?.focus?.(); };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  // body'ye portal: panel kaplamasının yığın bağlamında kalıp alt gezinme çubuğunun altına düşmesin
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={hid} className={`sheet auto${wide ? " wide" : ""}`} style={{ outline: "none" }}>
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h3 id={hid}>{title}</h3>
          <button type="button" className="btn ghost icon sm" aria-label={closeLabel} onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
