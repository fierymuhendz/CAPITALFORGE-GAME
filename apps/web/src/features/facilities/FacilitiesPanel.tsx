"use client";
import { useState } from "react";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, EmptyState, Icon, Stat } from "@/ui";
import { usePlay } from "../play/context";
import { FacilityDetail } from "./FacilityDetail";
import "./operations.css";

export function FacilitiesPanel() {
  const { t, num } = useT();
  const cat = useCat();
  const { company, open, select } = usePlay();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Async res={company}>
      {(c) => {
        const f = c.facilities.find((x) => x.id === sel);
        if (f) return <div className="col"><Button className="ops-back" variant="ghost" size="sm" onClick={() => setSel(null)}><Icon name="back" size={16} />{t("common.back")}</Button><FacilityDetail f={f} /></div>;
        if (!c.facilities.length) return <EmptyState icon="factory" title={t("facility.emptyTitle")} text={t("facility.emptyText")} action={<Button variant="primary" onClick={() => open(null)}>{t("facility.goCity")}</Button>} />;
        const sites = c.facilities.map((site) => {
          const jobs = site.jobs.filter((j) => j.status === "running").sort((a, b) => a.endsAt.localeCompare(b.endsAt));
          const free = site.status === "constructing" ? 0 : Math.max(0, site.lines - jobs.length);
          return { site, jobs, free };
        });
        return (
          <div className="col ops-panel">
            <div className="ops-metrics">
              <Stat label={t("operations.facilities")} value={num(sites.length)} />
              <Stat label={t("facility.lines")} value={num(sites.reduce((n, s) => n + s.jobs.length, 0))} />
              <Stat label={t("operations.freeLines")} value={num(sites.reduce((n, s) => n + s.free, 0))} />
            </div>
            {sites.map(({ site, jobs, free }) => (
              <Card key={site.id} className="ops-site">
                <div className="ops-identity"><span className="ops-symbol"><Icon name={site.type === "garage" ? "truck" : site.lines ? "factory" : "building"} /></span>
                  <div><h3>{cat.building(site.type)}</h3><span className="small muted2">{cat.city(site.cityId)} · {t("common.level")} {site.level}</span></div>
                  <Badge tone={site.status === "stalled" ? "bad" : site.status === "working" ? "good" : undefined}>{t(`facility.status.${site.status}`)}</Badge>
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
      }}
    </Async>
  );
}
