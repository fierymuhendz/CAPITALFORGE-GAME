"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyDto, ShipmentDto, WorldMapDto } from "@capitalforge/shared";
import { useApp } from "@/lib/app";
import { useData, useList } from "@/lib/data";
import { useGate } from "@/lib/gate";
import { useT } from "@/lib/i18n";
import { serverOffsetMs } from "@/lib/clock";
import { Badge, Button, Icon, Sheet } from "@/ui";
import type { CitySelection } from "../../scene";
import { COVERED_BY_OPS, CompanyPanel } from "../company/CompanyPanel";
import { OpsBoard } from "../company/OpsBoard";
import "./workspace.css";
import { CityStage, resolveQuality } from "./CityStage";
import { PANEL_IDS, PlayProvider, type PanelId } from "./context";
import { PANELS } from "./panels";
import { SelectionPanel } from "./Selection";

function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 980px)");
    const f = () => setM(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);
  return m;
}

const TABS: Array<{ id: PanelId | "city" | "more"; icon: string; key: string }> = [
  { id: "city", icon: "city", key: "tabs.city" },
  { id: "facilities", icon: "factory", key: "tabs.production" },
  { id: "inventory", icon: "box", key: "tabs.inventory" },
  { id: "market", icon: "chart", key: "tabs.market" },
  { id: "logistics", icon: "truck", key: "tabs.logistics" },
  { id: "more", icon: "more", key: "tabs.more" },
];

export function PlayShell() {
  const ok = useGate("company");
  const { me, world, conn } = useApp();
  const i = useT();
  const { t } = i;
  const router = useRouter();
  const sp = useSearchParams();
  const mobile = useIsMobile();
  const company = useData<CompanyDto>(me?.company ? "/company" : null, undefined, ["company", "facilities", "finance", "inventory", "research", "contracts", "shipments", "freight", "market"]);
  const map = useData<WorldMapDto>(me?.company ? "/world/map" : null, undefined, ["map", "facilities", "shipments", "company"]);
  const ships = useList<ShipmentDto>(me?.company ? "/shipments" : null, { scope: "mine" }, ["shipments"]);
  const inTransitJobs = (ships.data ?? []).filter((s) => s.status === "in_transit").length;
  const [selection, setSelection] = useState<CitySelection | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);

  const ALIAS: Record<string, PanelId> = { freight: "logistics", shipments: "logistics", sales: "finance" };
  const pRaw = sp.get("tab") ?? sp.get("p");
  const pMapped = pRaw ? ALIAS[pRaw] ?? pRaw : null;
  const panel: PanelId | null = PANEL_IDS.includes(pMapped as PanelId) ? (pMapped as PanelId) : null;
  useEffect(() => { setSelection(null); }, [pRaw]);
  const homeCity = me?.company?.homeCityId ?? null;
  const focusCityId = focus ?? homeCity;

  const open = useCallback((p: PanelId | null, opts?: { focusCity?: string; params?: Record<string, string> }) => {
    if (opts?.focusCity) setFocus(opts.focusCity);
    setSelection(null);
    setMapOnly(false);
    const q = new URLSearchParams(p ? { tab: p, ...(opts?.params ?? {}) } : {}).toString();
    router.replace(q ? `/play?${q}` : "/play", { scroll: false });
  }, [router]);

  const select = useCallback((s: CitySelection | null) => setSelection(s), []);
  const ctx = useMemo(() => ({ company, map, selection, select, open, panel, focusCityId, setFocusCity: setFocus }), [company, map, selection, select, open, panel, focusCityId]);

  const graphics = me?.account?.graphics;
  const quality = useMemo(() => resolveQuality(graphics), [graphics, mobile]);
  if (!ok || !me?.company || !world) return null;
  const c = company.data ?? me.company;
  const Active = PANELS.find((x) => x.id === (panel ?? "company"))!;
  const activeTab: string = selection ? "city" : panel === "facilities" || panel === "inventory" || panel === "market" || panel === "logistics" ? panel : panel ? "more" : "city";
  const xpPct = c.nextLevelXp ? Math.min(100, Math.round((c.xp / c.nextLevelXp) * 100)) : 100;

  const title = selection ? t("play.selection") : t(`panels.${Active.id}`);
  const home = !panel;
  const lines = company.data ? company.data.facilities.reduce((a, f) => ({ run: a.run + f.jobs.filter((j) => j.status === "running").length, all: a.all + (f.status === "constructing" ? 0 : f.lines) }), { run: 0, all: 0 }) : null;
  const figures = [
    { label: "finance.cash", value: i.money(c.cash), target: "finance" },
    { label: "decide.ops.linesFigure", value: lines ? `${i.num(lines.run)} / ${i.num(lines.all)}` : "…", target: "facilities" },
    { label: "decide.ops.inTransitFigure", value: ships.data ? i.num(inTransitJobs) : "…", target: "logistics" },
    { label: "company.profit7d", value: company.data ? i.money(company.data.stats.profit7d) : "…", target: "finance" },
  ] as const;
  const renderMap = () => (
    <section className="cf-map-card">
      <div className="cf-map-head"><h2>{t("workspace.map")}</h2>
        <div className="row">
          <select className="input" value={focusCityId ?? ""} onChange={(e) => setFocus(e.target.value)} aria-label={t("play.cities")}>
            {world.cities.map((city) => <option value={city.id} key={city.id}>{i.name(city.name)}</option>)}
          </select>
          <Button size="sm" icon variant="ghost" aria-label={mapOnly ? t("play.collapse") : t("play.expand")} aria-pressed={mapOnly} onClick={() => setMapOnly(!mapOnly)}><Icon name={mapOnly ? "shrink" : "expand"} /></Button>
        </div>
      </div>
      <div className="stage cf-map-stage">
        <CityStage myLevel={c.level} world={world} map={map.data} serverOffsetMs={serverOffsetMs()} quality={quality} myCompanyId={c.id} focusCityId={focusCityId} selected={selection} onSelect={select} locale={i.locale} />
        {map.error && !map.data ? <div className="notice bad cf-map-error">{i.err(map.error)} <Button size="sm" onClick={map.reload}>{t("common.retry")}</Button></div> : null}
      </div>
    </section>
  );
  return (
    <PlayProvider value={ctx}>
      <div className="play cf-workspace">
        <a className="skip" href="#panel">{t("common.skipToPanel")}</a>
        {conn === "closed" || conn === "connecting" ? <div className="conn" role="status"><span className="spin btn" style={{ minHeight: 0, border: 0, padding: 0, background: "none" }} aria-hidden="true" />{t("conn.lost")}</div> : null}
        <header className="play-top">
          <Link href="/play" className="brand" onClick={() => open(null)} aria-label="Capital Forge"><span className="mark" aria-hidden="true">CF</span><span className="hide-sm">Capital Forge</span></Link>
          <button type="button" className="btn ghost sm co-btn" onClick={() => open("company")} title={c.name}>
            <span className="nm">{c.name}</span><span className="hide-xs"><Badge tone="forge">{t("common.levelShort", { n: c.level })}</Badge></span>
          </button>
          <div className="kpis">
            <button type="button" className="btn ghost sm" onClick={() => open("finance")} aria-label={`${t("finance.cash")}: ${i.money(c.cash)}`} title={i.money(c.cash)}>
              <span className="muted xs hide-sm">{t("finance.cash")}</span> <b className="num money">{i.money(c.cash)}</b>
            </button>
            {c.arrears !== "0" ? <button type="button" className="btn ghost sm" onClick={() => open("finance")} title={`${t("finance.arrears")}: ${i.money(c.arrears)}`} aria-label={`${t("finance.arrears")}: ${i.money(c.arrears)}`}><Badge tone="bad"><Icon name="alert" size={12} /><span className="hide-sm">{t("finance.arrears")}: {i.money(c.arrears, true)}</span></Badge></button> : null}
            <span className="hide-sm xs muted" title={t("company.xp")}>XP {xpPct}%</span>
            <button type="button" className="btn ghost icon sm" onClick={() => open("notifications")} aria-label={`${t("panels.notifications")}${c.unreadNotifications ? ` (${c.unreadNotifications})` : ""}`} style={{ position: "relative" }}>
              <Icon name="bell" />{c.unreadNotifications ? <span className="badge forge" style={{ position: "absolute", top: -2, right: -4 }}>{c.unreadNotifications}</span> : null}
            </button>
          </div>
        </header>

        <div className="play-main cf-frame">
          {!mobile ? (
            <nav className="side-rail cf-nav" aria-label={t("play.panels")}>
              <button type="button" className="rail-btn" aria-current={home ? "page" : undefined} onClick={() => open(null)}><Icon name="city" /><span>{t("workspace.home")}</span></button>
              {PANELS.map((p) => (
                <button key={p.id} type="button" className="rail-btn" aria-current={panel === p.id ? "page" : undefined} onClick={() => open(p.id)}>
                  <Icon name={p.icon} /><span>{t(`panels.${p.id}`)}</span>
                  {p.id === "notifications" && c.unreadNotifications ? <span className="badge forge">{c.unreadNotifications}</span> : null}
                </button>
              ))}
              {me.account?.role === "admin" ? <Link className="rail-btn" href="/admin"><Icon name="shield" />{t("admin.title")}</Link> : null}
            </nav>
          ) : null}
          <main className="cf-main" id="panel" key={panel ?? "home"}>
            {home && !(mobile && selection) ? (
              <div className={mapOnly && !selection ? "cf-home cf-map-only" : "cf-home"}>
                <div className="cf-title">
                  <div><p>{t(`sector.${c.sector}`)} · {i.name(world.cities.find((city) => city.id === c.homeCityId)?.name ?? { tr: "", en: "" })}</p><h1>{c.name}</h1></div>
                  <Button size="sm" onClick={() => open("market")}><Icon name="chart" size={16} />{t("workspace.exchange")}</Button>
                </div>
                <div className="cf-ledger">
                  {figures.map((f) => <button type="button" key={f.label} onClick={() => open(f.target)}><span>{t(f.label)}</span><strong>{f.value}</strong></button>)}
                </div>
                <div className="cf-city-grid">
                  {renderMap()}
                  <aside className="cf-decisions" aria-label={selection ? title : t("decide.ops.title")}>
                    {selection ? <>
                      <div className="cf-selection-head"><h2>{title}</h2><Button size="sm" icon variant="ghost" aria-label={t("common.close")} onClick={() => setSelection(null)}><Icon name="x" /></Button></div>
                      <SelectionPanel onClose={() => setSelection(null)} />
                    </> : <>
                      <OpsBoard />
                      {company.data?.nextSteps.some((s) => !COVERED_BY_OPS.has(s.key)) ? <div className="cf-next"><CompanyPanel compact /></div> : null}
                    </>}
                  </aside>
                </div>
              </div>
            ) : (
              <section className="cf-data pane" aria-label={title}>
                <div className="pane-head cf-page-head">
                  <div><p>{c.name}</p><h1>{title}</h1></div>
                  <Button variant="ghost" size="sm" aria-label={selection ? t("common.back") : t("workspace.home")} onClick={() => selection ? setSelection(null) : open(null)}><Icon name="back" size={16}/><span>{selection ? t("common.back") : t("workspace.home")}</span></Button>
                </div>
                <div className="pane-body">{selection ? <SelectionPanel onClose={() => setSelection(null)} /> : <Active.Comp />}</div>
              </section>
            )}
          </main>
        </div>

        {mobile ? (
          <>
            <nav className="tabbar" aria-label={t("play.panels")}>
              {TABS.map((x) => (
                <button key={x.id} type="button" aria-current={activeTab === x.id ? "page" : undefined}
                  onClick={() => { if (x.id === "city") { setMoreOpen(false); open(null); } else if (x.id === "more") { setSelection(null); setMoreOpen(true); } else { setMoreOpen(false); open(x.id); } }}>
                  <Icon name={x.icon} />{t(x.key)}
                  {x.id === "more" && c.unreadNotifications ? <span className="pip">{c.unreadNotifications}</span> : null}
                </button>
              ))}
            </nav>
            <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t("tabs.more")} closeLabel={t("common.close")}>
              <div className="list">
                {PANELS.filter((p) => p.id !== "facilities" && p.id !== "inventory" && p.id !== "market" && p.id !== "logistics").map((p) => (
                  <button key={p.id} type="button" className="li click btn ghost block" style={{ justifyContent: "flex-start" }} onClick={() => { setMoreOpen(false); open(p.id); }}>
                    <Icon name={p.icon} />{t(`panels.${p.id}`)}
                    {p.id === "notifications" && c.unreadNotifications ? <Badge tone="forge">{c.unreadNotifications}</Badge> : null}
                  </button>
                ))}
                {me.account?.role === "admin" ? <Link href="/admin" className="li click btn ghost block" style={{ justifyContent: "flex-start" }}><Icon name="shield" />{t("admin.title")}</Link> : null}
              </div>
            </Sheet>
          </>
        ) : null}
      </div>
    </PlayProvider>
  );
}
