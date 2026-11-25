"use client";
import type { KeyboardEvent, ReactNode } from "react";

export interface TabItem { id: string; label: ReactNode; badge?: number }

export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (id: string) => void; label?: string }) {
  const kd = (e: KeyboardEvent) => {
    const i = items.findIndex((x) => x.id === value);
    if (e.key === "ArrowRight") onChange(items[(i + 1) % items.length]!.id);
    if (e.key === "ArrowLeft") onChange(items[(i - 1 + items.length) % items.length]!.id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={kd}>
      {items.map((x) => (
        <button key={x.id} type="button" role="tab" className="tab" aria-selected={x.id === value} tabIndex={x.id === value ? 0 : -1} onClick={() => onChange(x.id)}>
          {x.label}{x.badge ? <span className="badge forge">{x.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ items, value, onChange, label }: { items: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((x) => <button key={x.id} type="button" aria-pressed={x.id === value} onClick={() => onChange(x.id)}>{x.label}</button>)}
    </div>
  );
}
