"use client";
import type { OnboardingDto } from "@capitalforge/shared";
import { useT } from "@/lib/i18n";

/** 4x4 arsa haritası (kuruluş sihirbazı). Durum simgesi + renk: ✓ uygun, ✕ uygun değil. */
export function PlotGrid({ plots, selected, onSelect }: { plots: OnboardingDto["plots"]; selected: string | null; onSelect: (id: string) => void }) {
  const { t, money } = useT();
  const sorted = [...plots].sort((a, b) => a.gz - b.gz || a.gx - b.gx);
  return (
    <div className="plotgrid" style={{ maxWidth: 560, width: "100%", margin: "0 auto" }} role="group" aria-label={t("found.plotMap")}>
      {sorted.map((p) => (
        <button key={p.id} type="button" className={`plot ${p.owner ? "taken" : ""} ${p.eligible ? "" : "bad"}`} aria-pressed={selected === p.id}
          aria-label={`${p.gx + 1}·${p.gz + 1}, ${money(p.price, true)}, ${p.eligible ? t("found.eligible") : p.reasons.map((r) => t(`found.reason.${r}`)).join(", ")}`} onClick={() => onSelect(p.id)}>
          <span className="row between"><b>{p.gx + 1}·{p.gz + 1}</b><span className={p.eligible ? "good" : "bad"} aria-hidden="true">{p.eligible ? "✓" : "✕"}</span></span>
          <span className="num xs">{money(p.price, true)}</span>
          <span className="xs muted">{p.sizeHa} ha</span>
        </button>
      ))}
    </div>
  );
}
