"use client";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, KV, ProgressBar, Stat, Trend } from "@/ui";
import { usePlay, type PanelId } from "../play/context";

const STEP_TARGET: Record<string, PanelId> = {
  pay_arrears: "finance", fix_stalled: "facilities", first_job: "facilities", first_sale: "market", empty_warehouse: "facilities",
  first_freight: "logistics", take_loan: "finance", upgrade_facility: "facilities", start_research: "research",
};

export function CompanyPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { company, open } = usePlay();
  return (
    <Async res={company}>
      {(d) => {
        const lvlPct = d.nextLevelXp ? Math.min(100, (d.xp / d.nextLevelXp) * 100) : 100;
        const total = d.stats.onTimeDeliveries + d.stats.lateOrMissed;
        const stepParams = (p: Record<string, string | number> | undefined) => {
          const out: Record<string, string | number> = { ...(p ?? {}) };
          if (typeof out.facility === "string") out.facility = cat.building(out.facility);
          if (typeof out.recipe === "string" && out.recipe) out.recipe = cat.recipe(out.recipe);
          if (typeof out.amount === "string") out.amount = i.money(out.amount);
          if (typeof out.reason === "string" && out.reason) out.reason = i.has(`facility.stalled.${out.reason}`) ? t(`facility.stalled.${out.reason}`) : out.reason;
          return out;
        };
        return (
          <div className="col">
            <Card><div className="col">
              <div className="row between wrap"><h3>{d.name}</h3><Badge tone="forge">{t("common.level")} {d.level}</Badge></div>
              <span className="muted small">{t(`sector.${d.sector}`)} · {cat.city(d.homeCityId)}</span>
              <div className="col tight">
                <div className="row between small"><span>{t("company.xp")}</span><span className="num">{d.nextLevelXp ? `${i.num(d.xp)} / ${i.num(d.nextLevelXp)}` : t("company.maxLevel")}</span></div>
                <ProgressBar value={lvlPct} label={t("company.xp")} />
              </div>
              <div className="grid2">
                <Stat label={t("finance.cash")} value={i.money(d.cash)} />
                <Stat label={t("company.reputation")} value={i.pct(d.reputationBp)} sub={total ? t("company.onTime", { a: d.stats.onTimeDeliveries, b: total }) : t("company.noDeliveries")} />
                <Stat label={t("company.revenue7d")} value={i.money(d.stats.revenue7d)} />
                <Stat label={t("company.profit7d")} value={<Trend value={d.stats.profit7d} text={i.signed(d.stats.profit7d)} />} />
              </div>
              {d.arrears !== "0" ? <div className="notice bad" role="alert">⚠ {t("finance.arrears")}: <b>{i.money(d.arrears)}</b> <Button size="sm" onClick={() => open("finance")}>{t("finance.payArrears")}</Button></div> : null}
            </div></Card>

            <h3 style={{ fontSize: "var(--fs-md)" }}>{t("company.nextSteps")}</h3>
            {d.nextSteps.length ? d.nextSteps.map((s) => {
              const target = STEP_TARGET[s.key] ?? "company";
              const key = `nextSteps.${s.key}`;
              return (
                <Card key={s.key} tight><div className="col tight">
                  <b>{i.has(`${key}.title`) ? t(`${key}.title`, stepParams(s.params)) : s.key}</b>
                  {i.has(`${key}.text`) ? <span className="small muted2">{t(`${key}.text`, stepParams(s.params))}</span> : null}
                  <div><Button size="sm" variant="primary" onClick={() => open(target)}>{t(`nextSteps.go.${target}`)}</Button></div>
                </div></Card>
              );
            }) : <p className="muted small">{t("company.allDone")}</p>}

            <h3 style={{ fontSize: "var(--fs-md)" }}>{t("panels.facilities")} ({d.facilities.length})</h3>
            <div className="col tight">{d.facilities.map((f) => <KV key={f.id} k={`${cat.building(f.type)} · ${cat.city(f.cityId)}`} v={t(`facility.status.${f.status}`)} />)}</div>
            <h3 style={{ fontSize: "var(--fs-md)" }}>{t("logistics.fleet")} ({d.vehicles.length})</h3>
            <div className="col tight">{d.vehicles.map((v) => <KV key={v.id} k={cat.vehicle(v.modelId)} v={v.status === "in_transit" ? `→ ${cat.city(v.destCityId)}` : cat.city(v.cityId)} />)}</div>
          </div>
        );
      }}
    </Async>
  );
}
