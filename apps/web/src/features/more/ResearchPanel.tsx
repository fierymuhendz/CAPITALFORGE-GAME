"use client";
import type { ResearchDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, Disclosure, KV, ProgressBar } from "@/ui";

export function ResearchPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { run, busy } = useAction();
  const res = useData<ResearchDto>("/research", undefined, ["research", "company"]);
  const sector = me?.company?.sector;
  return (
    <Async res={res}>
      {(d) => {
        const anyBusy = d.items.some((x) => x.inProgress);
        const sectorOf = (id: string): string | null => {
          const e = cat.world.research.find((x) => x.id === id)?.effect as { sector?: string } | undefined;
          return e?.sector ?? null;
        };
        const mine = d.items.filter((r) => { const s = sectorOf(r.researchId); return s === null || s === sector; });
        const others = d.items.filter((r) => !mine.includes(r));
        const card = (r: ResearchDto["items"][number]) => {
          const def = cat.world.research.find((x) => x.id === r.researchId);
          const locked = (me?.company?.level ?? 1) < r.minCompanyLevel;
          const maxed = r.nextCost === null;
          return (
            <Card key={r.researchId} tight><div className="col tight">
              <div className="row between"><b className="nm">{cat.research(r.researchId)}</b><Badge tone={maxed ? "good" : "forge"}>{r.level}/{def?.maxLevel ?? "?"}</Badge></div>
              <span className="small muted2">{cat.researchDesc(r.researchId)}</span>
              <ProgressBar value={def ? (r.level / def.maxLevel) * 100 : 0} steel label={cat.research(r.researchId)} />
              {r.inProgress ? <span className="small">{t("research.inProgress", { n: r.inProgress.targetLevel })} <Countdown until={r.inProgress.endsAt} /></span> : maxed ? <span className="small good">✓ {t("errors.RESEARCH_MAXED")}</span> : (
                <>
                  <KV k={t("research.cost")} v={i.money(r.nextCost!)} />
                  <KV k={t("facility.remaining")} v={i.dur(r.nextMinutes ?? 0)} />
                  {locked ? <span className="small warn">⚠ {t("research.needLevel", { n: r.minCompanyLevel })}</span> : null}
                  <Button variant="primary" loading={busy} disabled={locked || anyBusy} onClick={() => void run(() => api.post(`/research/${r.researchId}/start`), { ok: "research.started" })}>{t("research.start")}</Button>
                </>
              )}
            </div></Card>
          );
        };
        return (
          <div className="col">
            {anyBusy ? <span className="muted small">{t("errors.RESEARCH_BUSY")}</span> : null}
            <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>{mine.map(card)}</div>
            {others.length ? <Disclosure summary={t("research.others", { n: others.length })}><div className="col">{others.map(card)}</div></Disclosure> : null}
          </div>
        );
      }}
    </Async>
  );
}
