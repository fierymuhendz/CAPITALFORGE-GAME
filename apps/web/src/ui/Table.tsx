"use client";
import type { KeyboardEvent, ReactNode } from "react";

export interface Col<T> {
  key: string;
  head: string;
  cell: (r: T) => ReactNode;
  right?: boolean;
  /** kartlarda etiketsiz göster */
  bare?: boolean;
  act?: boolean;
  /** kartlarda tam genişlik, vurgulu (satırın başlığı) */
  lead?: boolean;
  /** kartlarda tam genişlik */
  wide?: boolean;
  /** tabloda satır sonuna sarma */
  nowrap?: boolean;
}

/** `onRow`: satır klavyeyle de açılır; `onTap`: yalnızca dokunma kolaylığı (satırda ayrı bir eylem düğmesi vardır). Kap geniş: tablo; kap dar (container query): iki sütunlu etiket/değer kartı, eylem en altta tam genişlik. */
export function Table<T>({ cols, rows, rowKey, onRow, rowLabel, rowClass, onTap }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; rowLabel?: (r: T) => string; rowClass?: (r: T) => string; onTap?: (r: T) => void }) {
  const kd = (r: T) => (e: KeyboardEvent) => { if (onRow && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRow(r); } };
  return (
    <div className="tbl-wrap">
      <table className="tbl cards-sm">
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className={c.right ? "r" : ""}>{c.head}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={`${onRow || onTap ? "click" : ""} ${rowClass?.(r) ?? ""}`} tabIndex={onRow ? 0 : undefined} role={onRow ? "button" : undefined} aria-label={onRow ? rowLabel?.(r) : undefined} onClick={onRow ? () => onRow(r) : onTap ? () => onTap(r) : undefined} onKeyDown={onRow ? kd(r) : undefined}>
              {cols.map((c) => <td key={c.key} data-label={c.bare ? "" : c.head} className={[c.right ? "r" : "", c.act ? "act" : "", c.lead ? "lead" : "", c.wide ? "wide" : "", c.nowrap ? "nw" : ""].filter(Boolean).join(" ")}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
