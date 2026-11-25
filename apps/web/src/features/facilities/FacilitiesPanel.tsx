"use client";
import { useState } from "react";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, EmptyState } from "@/ui";
import { usePlay } from "../play/context";
import { FacilityDetail } from "./FacilityDetail";

export function FacilitiesPanel() {
  const { t } = useT();
  const cat = useCat();
  const { company, open, select } = usePlay();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Async res={company}>
      {(c) => {
        const f = c.facilities.find((x) => x.id === sel);
        if (f) return <div className="col"><Button variant="ghost" size="sm" onClick={() => setSel(null)}>← {t("common.back")}</Button><FacilityDetail f={f} /></div>;
        if (!c.facilities.length) return <EmptyState icon="factory" title={t("facility.emptyTitle")} text={t("facility.emptyText")} action={<Button variant="primary" onClick={() => open(null)}>{t("facility.goCity")}</Button>} />;
        return (
          <div className="col">
            {c.facilities.map((x) => {
              const next = x.jobs.filter((j) => j.status === "running").sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
              return (
                <Card key={x.id} onClick={() => setSel(x.id)}>
                  <div className="col tight">
                    <div className="row between"><b>{cat.building(x.type)}</b><Badge tone={x.status === "stalled" ? "bad" : x.status === "working" ? "good" : undefined}>{x.status === "stalled" ? "⚠ " : x.status === "working" ? "▶ " : ""}{t(`facility.status.${x.status}`)}</Badge></div>
                    <span className="muted small">{cat.city(x.cityId)} · {t("common.level")} {x.level}</span>
                    {next ? <span className="small">{cat.recipe(next.recipeId)} — <Countdown until={next.endsAt} /></span> : null}
                    {x.constructionEndsAt && x.status === "constructing" ? <span className="small">{t("facility.constructing")} <Countdown until={x.constructionEndsAt} /></span> : null}
                    {x.stalledReason ? <span className="small warn">⚠ {t(`facility.stalled.${x.stalledReason.code}`)}</span> : null}
                  </div>
                </Card>
              );
            })}
            <Button onClick={() => { select(null); open(null); }}>{t("facility.buyMore")}</Button>
          </div>
        );
      }}
    </Async>
  );
}
