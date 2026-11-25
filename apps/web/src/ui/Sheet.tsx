"use client";
import { useEffect, useRef, type ReactNode } from "react";
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

/** Modal: telefonda alt sayfa (bottom sheet), masaüstünde ortada pencere. Esc ile kapanır, odak içeri alınır. */
export function Sheet({ open, onClose, title, closeLabel, children, footer, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("keydown", k); (prev.current as HTMLElement | null)?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={`sheet auto${wide ? " wide" : ""}`} style={{ outline: "none" }}>
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost icon sm" aria-label={closeLabel} onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-head" style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>{footer}</div> : null}
      </div>
    </div>
  );
}
