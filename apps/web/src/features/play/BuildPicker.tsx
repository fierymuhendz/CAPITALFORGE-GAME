"use client";
import { useMemo, useState } from "react";
import { depositFits, type PlotDto, type WorldDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Icon, IndustryTag, Tag } from "@/ui";
import "../catalog/catalog.css";

type Bt = WorldDto["buildingTypes"][number];

/** Arsaya bina seçimi: varsayılan "Kurulabilir" süzgeci; uygun olmayanlar gerekçesiyle kapalı grupta. Karar sunucudadır; burada yalnızca ön kontrol gösterilir. */
export function BuildPicker({ plot, companyLevel, cash, steelHere, choice, onChoose }: { plot: PlotDto; companyLevel: number; cash: string; steelHere: number | null; choice: string | null; onChoose: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const [onlyOk, setOnlyOk] = useState(true);
  const [inds, setInds] = useState<string[]>([]);
  const plotLevelOk = companyLevel >= plot.minLevel;

  const rows = useMemo(() => cat.world.buildingTypes.map((b) => {
    const reasons: string[] = [];
    if (!depositFits({ requiresDeposit: b.requiresDeposit, deposits: b.deposits ?? undefined }, plot.deposit?.kind)) reasons.push(!plot.deposit ? t("found.reason.DEPOSIT_REQUIRED") : b.deposits ? t("build.depositNeeds", { kinds: b.deposits.map((d) => t(`deposit.${d}`)).join(", ") }) : t("errors.DEPOSIT_MISMATCH"));
    if (b.minCompanyLevel > companyLevel) reasons.push(t("build.needLevel", { n: b.minCompanyLevel }));
    if (BigInt(cash) < BigInt(plot.price) + BigInt(b.buildCost)) reasons.push(t("errors.INSUFFICIENT_FUNDS"));
    if (steelHere !== null && steelHere < b.buildSteelKg) reasons.push(t("build.needSteel", { have: i.qty(steelHere), need: i.qty(b.buildSteelKg) }));
    return { b, reasons, ok: reasons.length === 0 && plotLevelOk };
  }).sort((a, z) => Number(z.ok) - Number(a.ok) || (a.b.industry ?? "").localeCompare(z.b.industry ?? "") || a.b.tier - z.b.tier || i.name(a.b.name).localeCompare(i.name(z.b.name), i.locale)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cat.world, plot, companyLevel, cash, steelHere, plotLevelOk, i.locale]);

  const present = cat.world.industries.filter((x) => rows.some((r) => r.b.industry === x));
  const byInd = rows.filter((r) => !inds.length || (r.b.industry && inds.includes(r.b.industry)));
  const main = onlyOk ? byInd.filter((r) => r.ok) : byInd;
  const rest = onlyOk ? byInd.filter((r) => !r.ok) : [];
  const okCount = rows.filter((r) => r.ok).length;

  const card = (r: { b: Bt; reasons: string[]; ok: boolean }, selectable: boolean) => {
    const { b } = r;
    const body = (
      <>
        <div className="row between"><b>{i.name(b.name)}</b><span className="num small">{i.money(b.buildCost)}</span></div>
        <div className="row wrap"><IndustryTag industry={b.industry} /><Tag>{t("catalog.tier", { n: b.tier })}</Tag></div>
        {b.description ? <span className="small muted2">{i.name(b.description)}</span> : null}
        <span className="small muted2">{cat.product("steel")}: {i.qty(b.buildSteelKg)} · {i.dur(b.buildMinutes)}</span>
        {r.ok ? <span><Tag tone="good" icon="check">{t("play.canBuild")}</Tag></span> : <span className="bp-reasons">{(r.reasons.length ? r.reasons : [t("errors.LEVEL_TOO_LOW")]).map((x) => <Tag key={x} tone="warn" icon="alert">{x}</Tag>)}</span>}
      </>
    );
    return selectable
      ? <button key={b.id} type="button" className={`card tight click bp-card${choice === b.id ? " sel" : ""}`} aria-pressed={choice === b.id} onClick={() => onChoose(b.id)}>{body}</button>
      : <div key={b.id} className="card tight flat bp-card" aria-disabled="true">{body}</div>;
  };

  return (
    <div className="bp">
      {!plotLevelOk ? <div className="notice warn" role="status"><Icon name="alert" size={16} />{t("errors.LEVEL_TOO_LOW")} ({t("common.level")} {plot.minLevel})</div> : null}
      <div className="cf-chips" role="group" aria-label={t("build.filters")}>
        <button type="button" className="chip" aria-pressed={onlyOk} onClick={() => setOnlyOk(!onlyOk)}><Icon name="check" size={14} />{t("build.onlyOk")} ({okCount})</button>
        {present.map((x) => (
          <button key={x} type="button" className="chip" aria-pressed={inds.includes(x)} onClick={() => setInds(inds.includes(x) ? inds.filter((y) => y !== x) : [...inds, x])}>
            <i className="ind-sw" aria-hidden="true" style={{ "--c": `var(--ind-${x})` } as React.CSSProperties} />{t(`industry.${x}`)}
          </button>
        ))}
      </div>
      <div className="col tight">
        {main.map((r) => card(r, r.ok))}
        {!main.length ? <p className="small muted2" role="status">{t("build.noneOk")}</p> : null}
      </div>
      {rest.length ? (
        <details className="disc">
          <summary>{t("build.unavailable", { n: rest.length })}</summary>
          <div className="disc-body col tight">{rest.map((r) => card(r, false))}</div>
        </details>
      ) : null}
    </div>
  );
}
