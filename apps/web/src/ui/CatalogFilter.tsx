"use client";
import { useId, useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import { Icon } from "./icons";

export interface FilterOption { id: string; label: string; /** iş kolu kimliği: renkli kare eklenir */ industry?: string }
export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption[];
  /** aynı gruptan birden çok çip: "any" (biri yeter, varsayılan) ya da "all" (hepsi) */
  mode?: "any" | "all";
}
export interface FilterState { q: string; sel: Record<string, string[]> }
export const EMPTY_FILTER: FilterState = { q: "", sel: {} };

export const chipCount = (s: FilterState): number => Object.values(s.sel).reduce((a, b) => a + b.length, 0);
export const isFiltered = (s: FilterState): boolean => chipCount(s) > 0 || s.q.trim() !== "";

/** Grupta çip seçili değilse geçer; "any": biri sağlanmalı, "all": hepsi. */
export function passGroup(s: FilterState, g: { id: string; mode?: "any" | "all" }, test: (optionId: string) => boolean): boolean {
  const on = s.sel[g.id] ?? [];
  if (!on.length) return true;
  return g.mode === "all" ? on.every(test) : on.some(test);
}

/** Ortak katalog süzgeci: aksan duyarsız arama + gruplu çipler, seçili çip sayısı ve "Temizle". Telefonda çipler açılır panelde. */
export function CatalogFilter({ groups, state, onChange, shown, total, label }: { groups: FilterGroup[]; state: FilterState; onChange: (s: FilterState) => void; shown: number; total: number; label: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const pid = useId();
  const n = chipCount(state);
  const toggle = (gid: string, oid: string) => {
    const cur = state.sel[gid] ?? [];
    onChange({ ...state, sel: { ...state.sel, [gid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] } });
  };
  return (
    <div className="cf-filter" role="search" aria-label={label}>
      <div className="cf-filter-bar">
        <input className="input" type="search" value={state.q} onChange={(e) => onChange({ ...state, q: e.target.value })} placeholder={t("filter.search")} aria-label={t("filter.search")} autoComplete="off" spellCheck={false} />
        <button type="button" className="btn" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(!open)}><Icon name="split" size={16} />{t("filter.chips")}{n ? ` (${n})` : ""}</button>
        {isFiltered(state) ? <button type="button" className="btn ghost" onClick={() => onChange(EMPTY_FILTER)}><Icon name="x" size={16} />{t("filter.clear")}</button> : null}
      </div>
      {!open && n ? (
        <div className="cf-chips" role="group" aria-label={t("filter.selected", { n })}>
          {groups.flatMap((g) => (state.sel[g.id] ?? []).map((id) => ({ g, o: g.options.find((x) => x.id === id) }))).filter((x) => x.o).map(({ g, o }) => (
            <button key={`${g.id}-${o!.id}`} type="button" className="chip" aria-pressed="true" aria-label={`${o!.label}: ${t("filter.clear")}`} onClick={() => toggle(g.id, o!.id)}>
              {o!.industry ? <i className="ind-sw" aria-hidden="true" style={{ "--c": `var(--ind-${o!.industry})` } as CSSProperties} /> : null}{o!.label}<Icon name="x" size={14} />
            </button>
          ))}
        </div>
      ) : null}
      <p className="xs muted2 cf-filter-count" role="status" aria-live="polite">{n ? t("filter.selected", { n }) + " · " : ""}{t("filter.shown", { a: shown, b: total })}</p>
      <div id={pid} hidden={!open} className="cf-filter-groups">
        {groups.map((g) => (
          <fieldset key={g.id} className="cf-filter-group">
            <legend>{g.label}</legend>
            <div className="cf-chips">
              {g.options.map((o) => (
                <button key={o.id} type="button" className="chip" aria-pressed={(state.sel[g.id] ?? []).includes(o.id)} onClick={() => toggle(g.id, o.id)}>
                  {o.industry ? <i className="ind-sw" aria-hidden="true" style={{ "--c": `var(--ind-${o.industry})` } as CSSProperties} /> : null}
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
