"use client";
import { useSearchParams } from "next/navigation";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Async, Button, Card, Countdown, EmptyState, Icon, Stat, Status } from "@/ui";
import { usePlay } from "../play/context";
import { FacilityDetail } from "./FacilityDetail";
import "./operations.css";

export function FacilitiesPanel() {
  const { t, num } = useT();
  const cat = useCat();
  const { company, open, select } = usePlay();
  const sp = useSearchParams();
  const sel = sp.get("facility");
  const recipe = sp.get("recipe");
  const setSel = (id: string | null) => open("facilities", id ? { params: { facility: id } } : undefined);
  return (
    <Async res={company}>
      {(c) => {
        // tek tesis varken liste adımı atlanır: oyuncu doğrudan üretim kararına gelir
        const f = c.facilities.find((x) => x.id === sel) ?? (c.facilities.length === 1 ? c.facilities[0] : undefined);
        if (f && c.facilities.length === 1) return <FacilityDetail f={f} initialRecipe={recipe} />;
        if (!c.facilities.length) return <EmptyState icon="factory" title={t("facility.emptyTitle")} text={t("facility.emptyText")} action={<Button variant="primary" onClick={() => open(null)}>{t("facility.goCity")}</Button>} />;
        const sites = c.facilities.map((site) => {
          const jobs = site.jobs.filter((j) => j.status === "running").sort((a, b) => a.endsAt.localeCompare(b.endsAt));
          const free = site.status === "constructing" ? 0 : Math.max(0, site.lines - jobs.length);
          return { site, jobs, free };
        });
        const list = (
          <div className="col ops-panel">
            <div className="ops-metrics">
              <Stat label={t("operations.facilities")} value={num(sites.length)} />
              <Stat label={t("facility.lines")} value={num(sites.reduce((n, s) => n + s.jobs.length, 0))} />
              <Stat label={t("operations.freeLines")} value={num(sites.reduce((n, s) => n + s.free, 0))} />
            </div>
            {sites.map(({ site, jobs, free }) => (
              <Card key={site.id} className={`ops-site${f?.id === site.id ? " sel" : ""}`}>
                <div className="ops-identity"><span className="ops-symbol"><Icon name={site.type === "garage" ? "truck" : site.lines ? "factory" : "building"} /></span>
                  <div><h3>{cat.building(site.type)}</h3><span className="small muted2">{cat.city(site.cityId)} · {t("common.level")} {site.level}</span></div>
                  <Status kind={site.status === "stalled" ? "stop" : site.status === "constructing" ? "build" : jobs.length ? "run" : "idle"}>{t(`facility.status.${site.status}`)}</Status>
                </div>
                {site.lines > 0 && site.status !== "constructing" ? <div className="ops-load"><span>{t("facility.lines")}</span><b>{jobs.length} / {site.lines}</b><progress value={jobs.length} max={site.lines} aria-label={t("facility.lines")} /></div> : null}
                {jobs[0] ? <div className="ops-info"><Icon name="clock" size={15} />{cat.recipe(jobs[0].recipeId)} · <Countdown until={jobs[0].endsAt} /></div> : null}
                {site.constructionEndsAt && site.status === "constructing" ? <span className="small">{t("facility.constructing")} <Countdown until={site.constructionEndsAt} /></span> : null}
                {site.stalledReason ? <span className="small warn">{t(`facility.stalled.${site.stalledReason.code}`)}</span> : null}
                <Button className="ops-site-action" size="sm" variant={free ? "primary" : "secondary"} onClick={() => setSel(site.id)}>{t(free ? "facility.startJob" : "facility.open")}<span aria-hidden="true">→</span></Button>
              </Card>
            ))}
            <Button onClick={() => { select(null); open(null); }}><Icon name="plus" size={16} />{t("facility.buyMore")}</Button>
          </div>
        );
        // masaüstü: liste solda, seçili tesis sağda; telefon: önce liste, seçince ayrıntı + geri
        return (
          <div className={`ops-split${f ? " has-detail" : ""}`}>
            <div className="ops-split-list">{list}</div>
            {f ? <div className="ops-split-detail"><Button className="ops-back" variant="ghost" size="sm" onClick={() => setSel(null)}><Icon name="back" size={16} />{t("panels.facilities")}</Button><FacilityDetail f={f} initialRecipe={recipe} /></div> : null}
          </div>
        );
      }}
    </Async>
  );
}
