"use client";
import type { CSSProperties } from "react";
import type { Industry, ProductStage, ResearchBranch } from "@capitalforge/shared";
import { useT } from "@/lib/i18n";

/** Aşama işareti (ad solunda): hammadde dolu nokta, ara mal yarım, nihai mal halka. Şekil + erişilebilir ad; renkle ayrılmaz. */
export function StageMark({ stage }: { stage: ProductStage | null | undefined }) {
  const { t } = useT();
  if (!stage) return <span className="stage-mark" aria-hidden="true" />;
  const label = t(`stage.${stage}`);
  return (
    <svg className="stage-mark" width="12" height="12" viewBox="0 0 12 12" role="img" aria-label={label} focusable="false">
      <title>{label}</title>
      {stage === "raw" ? <circle cx="6" cy="6" r="5" fill="currentColor" /> : null}
      {stage === "intermediate" ? <><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 1.6a4.4 4.4 0 010 8.8z" fill="currentColor" /></> : null}
      {stage === "final" ? <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" /> : null}
    </svg>
  );
}

/** İş kolu etiketi: renkli kare + metin (renk tek başına anlam taşımaz). */
export function IndustryTag({ industry }: { industry: Industry | ResearchBranch | null | undefined }) {
  const { t } = useT();
  if (!industry) return null;
  return (
    <span className="tag ind" style={{ "--c": `var(--ind-${industry})` } as CSSProperties}>
      <i aria-hidden="true" />{t(`industry.${industry}`)}
    </span>
  );
}

export function Swatch({ industry }: { industry: string }) {
  return <i className="ind-sw" aria-hidden="true" style={{ "--c": `var(--ind-${industry})` } as CSSProperties} />;
}
