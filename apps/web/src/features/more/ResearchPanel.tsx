"use client";
import type { ResearchDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, KV, ProgressBar } from "@/ui";

export function ResearchPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { run, busy } = useAction();
  const res = useData<ResearchDto>("/research", undefined, ["research", "company"]);
  return (
    <Async res={res}>
      {(d) => (
        <div className="col">
          <p className="muted2 small">{t("research.intro")}</p>
          {d.items.map((r) => {
            const def = cat.world.research.find((x) => x.id === r.researchId);
            const locked = (me?.company?.level ?? 1) < r.minCompanyLevel;
            const maxed = r.nextCost === null;
            return (
              <Card key={r.researchId}><div className="col tight">
                <div className="row between"><b>{cat.research(r.researchId)}</b><Badge tone={maxed ? "good" : "forge"}>{r.level}/{def?.maxLevel ?? "?"}</Badge></div>
                <span className="small muted2">{cat.researchDesc(r.researchId)}</span>
                <ProgressBar value={def ? (r.level / def.maxLevel) * 100 : 0} steel label={cat.research(r.researchId)} />
                {r.inProgress ? <div className="notice steel">{t("research.inProgress", { n: r.inProgress.targetLevel })} <Countdown until={r.inProgress.endsAt} /></div> : maxed ? <span className="small good">✓ {t("errors.RESEARCH_MAXED")}</span> : (
                  <>
                    <KV k={t("research.cost")} v={i.money(r.nextCost!)} />
                    <KV k={t("facility.remaining")} v={t("common.minutes", { n: r.nextMinutes ?? 0 })} />
                    {locked ? <span className="small warn">⚠ {t("research.needLevel", { n: r.minCompanyLevel })}</span> : null}
                    <Button variant="primary" loading={busy} disabled={locked} onClick={() => void run(() => api.post(`/research/${r.researchId}/start`), { ok: "research.started" })}>{t("research.start")}</Button>
                  </>
                )}
              </div></Card>
            );
          })}
        </div>
      )}
    </Async>
  );
}
