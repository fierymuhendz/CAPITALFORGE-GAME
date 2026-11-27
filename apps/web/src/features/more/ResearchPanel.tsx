"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ResearchDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { matchQuery } from "@/lib/search";
import { Async, Badge, Button, Card, CatalogFilter, Countdown, EMPTY_FILTER, EmptyState, IndustryTag, KV, ProgressBar, Tag, passGroup, type FilterGroup, type FilterState } from "@/ui";
import { effectText } from "../catalog/effects";
import { ProductLink } from "../catalog/ProductSheet";
import { usePlay } from "../play/context";
import "../catalog/catalog.css";

type Item = ResearchDto["items"][number];
type Status = "startable" | "inProgress" | "prereq" | "level" | "maxed";
const STATUSES: Status[] = ["startable", "inProgress", "prereq", "level", "maxed"];
const statusOf = (r: Item): Status => (r.inProgress ? "inProgress" : r.blocked === "MAXED" || r.nextCost === null ? "maxed" : r.blocked === "LEVEL_TOO_LOW" ? "level" : r.blocked === "PREREQUISITE_MISSING" ? "prereq" : "startable");
const STATUS_ICON: Record<Status, string> = { startable: "bolt", inProgress: "clock", prereq: "alert", level: "alert", maxed: "check" };

export function ResearchPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { open } = usePlay();
  const { run, busy } = useAction();
  const res = useData<ResearchDto>("/research", undefined, ["research", "company"]);
  const sp = useSearchParams();
  const [f, setF] = useState<FilterState>(EMPTY_FILTER);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  const level = me?.company?.level ?? 1;
  const w = cat.world;

  const goto = useCallback((id: string): boolean => {
    const el = document.getElementById(`rs-${id}`);
    if (!el) return false;
    el.closest("details")?.setAttribute("open", "");
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
    setFlash(id);
    setTimeout(() => setFlash((x) => (x === id ? null : x)), 1800);
    return true;
  }, []);
  const jump = (id: string) => { if (!goto(id)) { setF(EMPTY_FILTER); setPending(id); } };
  useEffect(() => { if (pending && goto(pending)) setPending(null); }, [pending, f, res.data, goto]);
  const want = sp.get("focus");
  useEffect(() => { if (want && res.data && focused.current !== want) { focused.current = want; setPending(want); } }, [want, res.data]);

  const branches = useMemo(() => [...w.industries, "general"] as string[], [w.industries]);
  const groups: FilterGroup[] = [
    { id: "branch", label: t("rsch.branch"), options: branches.map((b) => ({ id: b, label: t(`industry.${b}`), industry: b })) },
    { id: "status", label: t("rsch.status"), options: STATUSES.map((s) => ({ id: s, label: t(`rsch.st.${s}`) })) },
  ];

  return (
    <Async res={res}>
      {(d) => {
        const anyBusy = d.items.find((x) => x.inProgress);
        const defOf = (id: string) => w.research.find((x) => x.id === id);
        const branchOf = (id: string) => defOf(id)?.branch ?? "general";
        const visible = d.items.filter((r) => {
          const def = defOf(r.researchId);
          return matchQuery(f.q, def?.name.tr, def?.name.en, def?.description.tr, def?.description.en)
            && passGroup(f, { id: "branch" }, (o) => branchOf(r.researchId) === o)
            && passGroup(f, { id: "status" }, (o) => statusOf(r) === o);
        });
        const unlocks = (id: string) => {
          const def = defOf(id);
          const ids = new Set<string>(def?.effect.kind === "unlock" ? def.effect.recipeIds : []);
          for (const rc of w.recipes) if (rc.research?.researchId === id) ids.add(rc.id);
          return [...ids].map((rid) => w.recipes.find((x) => x.id === rid)).filter((x): x is NonNullable<typeof x> => !!x);
        };
        const card = (r: Item) => {
          const def = defOf(r.researchId);
          const st = statusOf(r);
          const fx = def ? effectText(def.effect, i, cat) : null;
          const ul = unlocks(r.researchId);
          const firstMissing = r.missingPrerequisites[0];
          const reqs = def?.prerequisites ?? [];
          return (
            <Card key={r.researchId} tight className={`rs-card${flash === r.researchId ? " flash" : ""}`}>
              <div className="col tight" id={`rs-${r.researchId}`} tabIndex={-1} style={{ outline: "none" }}>
                <div className="row between"><b className="nm">{cat.research(r.researchId)}</b><Badge tone={st === "maxed" ? "good" : "forge"}>{t("rsch.levelOf", { a: r.level, b: def?.maxLevel ?? "?" })}</Badge></div>
                <div className="row wrap"><IndustryTag industry={branchOf(r.researchId) as never} /><Tag tone={st === "startable" ? "forge" : st === "maxed" ? "good" : st === "inProgress" ? "steel" : "warn"} icon={STATUS_ICON[st]}>{t(`rsch.st.${st}`)}</Tag></div>
                {!fx && !ul.length ? <span className="small muted2">{cat.researchDesc(r.researchId)}</span> : null}
                <div className="rs-fx">
                  {fx ? <span><b>{t("rsch.gain")}:</b> {fx}</span> : null}
                  {ul.length ? <span><b>{t("rsch.unlocks")}:</b> {ul.slice(0, 4).map((x, n) => <span key={x.id}>{n ? ", " : ""}{cat.recipe(x.id)}{" "}<span className="muted2">(<ProductLink id={x.output.productId} />)</span></span>)}{ul.length > 4 ? ` +${ul.length - 4}` : ""}</span> : null}
                </div>
                <ProgressBar value={def ? (r.level / def.maxLevel) * 100 : 0} steel label={cat.research(r.researchId)} />
                {reqs.length ? (
                  <div className="rs-prereq"><b>{t("rsch.prereq")}</b>
                    <ul>{reqs.map((q) => {
                      const miss = r.missingPrerequisites.find((x) => x.researchId === q.researchId);
                      return (
                        <li key={q.researchId}>
                          <button type="button" className="link-btn" onClick={() => jump(q.researchId)}>{cat.research(q.researchId)} · {t("common.level")} {q.level}</button>
                          {miss ? <Tag tone="warn" icon="alert">{t("rsch.missing", { a: miss.have, b: miss.level })}</Tag> : <Tag tone="good" icon="check">{t("rsch.met")}</Tag>}
                        </li>
                      );
                    })}</ul>
                  </div>
                ) : null}
                {st === "inProgress" && r.inProgress ? <span className="small">{t("research.inProgress", { n: r.inProgress.targetLevel })} <Countdown until={r.inProgress.endsAt} /></span> : null}
                {st !== "maxed" && st !== "inProgress" ? <><KV k={t("research.cost")} v={i.money(r.nextCost!)} /><KV k={t("rsch.time")} v={i.dur(r.nextMinutes ?? 0)} /></> : null}
                {st === "maxed" ? <span className="small good">✓ {t("errors.RESEARCH_MAXED")}</span> : null}
                {st === "startable" ? (anyBusy
                  ? <Button onClick={() => jump(anyBusy.researchId)}>{t("rsch.goBusy", { name: cat.research(anyBusy.researchId) })}</Button>
                  : <Button variant="primary" loading={busy} onClick={() => void run(() => api.post(`/research/${r.researchId}/start`), { ok: "research.started" })}>{t("rsch.start", { n: r.level + 1 })}</Button>) : null}
                {st === "prereq" && firstMissing ? <Button onClick={() => jump(firstMissing.researchId)}>{t("rsch.goPrereq", { name: cat.research(firstMissing.researchId) })}</Button> : null}
                {st === "level" ? <Button onClick={() => open("company")}>{t("rsch.needLevel", { n: r.minCompanyLevel })}</Button> : null}
                {st === "level" ? <span className="xs muted2">{t("rsch.yourLevel", { n: level })}</span> : null}
              </div>
            </Card>
          );
        };
        return (
          <div className="col">
            <CatalogFilter label={t("panels.research")} groups={groups} state={f} onChange={setF} shown={visible.length} total={d.items.length} />
            {anyBusy ? <span className="muted small">{t("errors.RESEARCH_BUSY")}</span> : null}
            {!visible.length ? <EmptyState icon="flask" title={t("rsch.empty")} text={t("rsch.emptyText")} action={<Button variant="primary" onClick={() => setF(EMPTY_FILTER)}>{t("filter.clear")}</Button>} /> : (
              <div className="rs-groups">
                {branches.map((b) => {
                  const rows = visible.filter((r) => branchOf(r.researchId) === b);
                  if (!rows.length) return null;
                  return (
                    <details key={b} className="rs-group" open>
                      <summary><IndustryTag industry={b as never} /><span className="muted2 small">{rows.length}</span></summary>
                      <div className="rs-grid">{rows.map(card)}</div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        );
      }}
    </Async>
  );
}
