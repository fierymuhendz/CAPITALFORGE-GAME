"use client";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { WorldDto } from "@capitalforge/shared";
import { useT } from "@/lib/i18n";
import { matchQuery } from "@/lib/search";
import { IndustryTag, StageMark } from "./Catalog";
import { Icon } from "./icons";

type P = WorldDto["products"][number];

/** 200+ ürün için arama kutulu seçici (ARIA combobox): ok tuşları, Enter seçer, Escape kapatır. */
export function ProductPicker({ label, value, onChange, products, extra, empty }: { label: string; value: string; onChange: (id: string) => void; products: P[]; extra?: (p: P) => ReactNode; empty?: string }) {
  const { t, name } = useT();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cur = products.find((p) => p.id === value);
  const list = useMemo(() => products.filter((p) => matchQuery(q, p.name.tr, p.name.en, p.id)), [products, q]);
  const idx = Math.min(hi, Math.max(0, list.length - 1));
  const pick = (p: P) => { onChange(p.id); setOpen(false); setQ(""); };
  const kd = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(Math.min(list.length - 1, (open ? idx : -1) + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(0, idx - 1)); }
    else if (e.key === "Enter" && open && list[idx]) { e.preventDefault(); pick(list[idx]!); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); setQ(""); }
    else if (e.key === "Home" && open) { e.preventDefault(); setHi(0); }
    else if (e.key === "End" && open) { e.preventDefault(); setHi(list.length - 1); }
  };
  return (
    <div className="field picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); setQ(""); } }}>
      <label htmlFor={`${uid}-i`}>{label}</label>
      <div className="picker-box">
        {cur && !open ? <span className="picker-lead" aria-hidden="true"><StageMark stage={cur.stage} /></span> : null}
        <input
          ref={inputRef} id={`${uid}-i`} className={`input${cur && !open ? " lead" : ""}`} role="combobox" aria-expanded={open} aria-controls={`${uid}-l`} aria-autocomplete="list"
          aria-activedescendant={open && list[idx] ? `${uid}-o-${list[idx]!.id}` : undefined} autoComplete="off" spellCheck={false}
          value={open ? q : cur ? name(cur.name) : ""} placeholder={t("filter.search")}
          onFocus={() => { setOpen(true); setHi(Math.max(0, products.findIndex((p) => p.id === value))); }}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onKeyDown={kd}
        />
        <button type="button" tabIndex={-1} className="picker-chev" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (open) { setOpen(false); } else { inputRef.current?.focus(); setOpen(true); } }}><Icon name="down" size={16} /></button>
        {open ? (
          <ul id={`${uid}-l`} role="listbox" aria-label={label} className="picker-list">
            {list.length === 0 ? <li className="picker-empty" role="presentation">{empty ?? t("filter.noMatch")}</li> : list.map((p, n) => (
              <li key={p.id} id={`${uid}-o-${p.id}`} role="option" aria-selected={p.id === value} className={`picker-opt${n === idx ? " hi" : ""}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setHi(n)}
                ref={(el) => { if (el && n === idx) el.scrollIntoView?.({ block: "nearest" }); }}>
                <StageMark stage={p.stage} /><span className="picker-name">{name(p.name)}</span>
                <IndustryTag industry={p.industry} />
                {extra ? <span className="picker-extra num">{extra(p)}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
