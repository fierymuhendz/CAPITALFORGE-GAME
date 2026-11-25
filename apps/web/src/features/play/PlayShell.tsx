"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyDto, WorldMapDto } from "@capitalforge/shared";
import { useApp } from "@/lib/app";
import { useData } from "@/lib/data";
import { useGate } from "@/lib/gate";
import { useT } from "@/lib/i18n";
import { serverOffsetMs } from "@/lib/clock";
import { Badge, Button, Icon, Sheet } from "@/ui";
import type { CitySelection } from "../../scene";
import { Brand } from "../common/Chrome";
import { CityStage, resolveQuality } from "./CityStage";
import { PANEL_IDS, PlayProvider, WIDE_PANELS, type PanelId } from "./context";
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
  const [selection, setSelection] = useState<CitySelection | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const m: Record<string, boolean> = {};
    try { for (const id of PANEL_IDS) if (localStorage.getItem(`cf-panel-wide:${id}`) === "1") m[id] = true; } catch { /* özel mod */ }
    setExpandedMap(m);
  }, []);

  const ALIAS: Record<string, PanelId> = { freight: "logistics", shipments: "logistics", sales: "finance" };
  const pRaw = sp.get("tab") ?? sp.get("p");
  const pMapped = pRaw ? ALIAS[pRaw] ?? pRaw : null;
  const panel: PanelId | null = PANEL_IDS.includes(pMapped as PanelId) ? (pMapped as PanelId) : null;
  useEffect(() => { setSelection(null); }, [pRaw]);
  const homeCity = me?.company?.homeCityId ?? null;
  const focusCityId = focus ?? homeCity;

  const open = useCallback((p: PanelId | null, opts?: { focusCity?: string }) => {
    if (opts?.focusCity) setFocus(opts.focusCity);
    setSelection(null);
    router.replace(p ? `/play?tab=${p}` : "/play", { scroll: false });
  }, [router]);

  const select = useCallback((s: CitySelection | null) => setSelection(s), []);
  const ctx = useMemo(() => ({ company, map, selection, select, open, panel, focusCityId, setFocusCity: setFocus }), [company, map, selection, select, open, panel, focusCityId]);

  if (!ok || !me?.company || !world) return null;
  const c = me.company;
  const quality = resolveQuality(me.account?.graphics);
  const Active = PANELS.find((x) => x.id === (panel ?? "company"))!;
  const activeTab: string = selection ? "city" : panel === "facilities" || panel === "market" || panel === "logistics" ? panel : panel ? "more" : "city";
  const xpPct = c.nextLevelXp ? Math.min(100, Math.round((c.xp / c.nextLevelXp) * 100)) : 100;

  const activeId = (panel ?? "company") as PanelId;
  const wide = WIDE_PANELS.includes(activeId) && !selection;
  const expanded = !!expandedMap[activeId] && !selection;
  const title = selection ? t("play.selection") : t(`panels.${Active.id}`);
  const toggleExpand = () => setExpandedMap((m) => { const v = { ...m, [activeId]: !m[activeId] }; try { localStorage.setItem(`cf-panel-wide:${activeId}`, v[activeId] ? "1" : "0"); } catch { /* özel mod */ } return v; });
  const paneBody = selection ? <SelectionPanel onClose={() => setSelection(null)} /> : <Active.Comp />;

  return (
    <PlayProvider value={ctx}>
      <div className="play">
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

        <div className="play-main">
          <section className="stage" aria-label={t("play.city")}>
            <div className="pill-scroll" style={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 5 }} role="group" aria-label={t("play.cities")}>
              {world.cities.map((x) => (
                <button key={x.id} type="button" className="chip" aria-pressed={focusCityId === x.id} onClick={() => setFocus(x.id)}>
                  <span className="dot" style={{ background: x.color }} aria-hidden="true" />{i.name(x.name)}
                </button>
              ))}
            </div>
            <div style={{ position: "absolute", inset: 0, paddingTop: 52 }}>
              <CityStage myLevel={c.level} world={world} map={map.data} serverOffsetMs={serverOffsetMs()} quality={quality} myCompanyId={c.id} focusCityId={focusCityId} selected={selection} onSelect={select} locale={i.locale} />
            </div>
            {map.error && !map.data ? <div className="notice bad" style={{ position: "absolute", left: 8, right: 8, bottom: 8 }}>{i.err(map.error)} <Button size="sm" onClick={map.reload}>{t("common.retry")}</Button></div> : null}
          </section>
          {!mobile ? (
            <aside className={`side${expanded ? " expanded" : ""}`} data-wide={wide ? "1" : undefined} id="panel" aria-label={t("play.panel")}>
              <nav className="side-rail" aria-label={t("play.panels")}>
                {PANELS.map((p) => (
                  <button key={p.id} type="button" className="rail-btn" aria-current={!selection && activeId === p.id ? "page" : undefined} onClick={() => open(p.id)} title={t(`panels.${p.id}`)} aria-label={t(`panels.${p.id}`)}>
                    <Icon name={p.icon} size={20} /><span className="lbl">{t(`panels.${p.id}`)}</span>
                    {p.id === "notifications" && c.unreadNotifications ? <span className="badge forge">{c.unreadNotifications}</span> : null}
                  </button>
                ))}
              </nav>
              <div className="pane side-main">
                <div className="pane-head">
                  {selection ? <Button variant="ghost" size="sm" icon onClick={() => setSelection(null)} aria-label={t("common.back")}><Icon name="back" /></Button> : null}
                  <h2>{title}</h2>
                  {!selection ? <Button variant="ghost" size="sm" icon onClick={toggleExpand} aria-pressed={expanded} title={expanded ? t("play.collapse") : t("play.expand")} aria-label={expanded ? t("play.collapse") : t("play.expand")}><Icon name={expanded ? "shrink" : "expand"} /></Button> : null}
                </div>
                <div className="pane-body">{paneBody}</div>
              </div>
            </aside>
          ) : null}
          {mobile && (panel || selection) && !moreOpen ? (
            <div className="m-panel pane" id="panel" role="region" aria-label={title}>
              <div className="pane-head">
                <h2>{title}</h2>
                <button type="button" className="btn ghost icon sm" aria-label={t("common.close")} onClick={() => (selection ? setSelection(null) : open(null))}><Icon name="x" /></button>
              </div>
              <div className="pane-body">{paneBody}</div>
            </div>
          ) : null}
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
                {PANELS.filter((p) => p.id !== "facilities" && p.id !== "market" && p.id !== "logistics").map((p) => (
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
