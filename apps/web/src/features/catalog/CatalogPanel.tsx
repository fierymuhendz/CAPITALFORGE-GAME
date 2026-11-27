"use client";
import { useMemo, useState } from "react";
import type { Industry } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { matchQuery } from "@/lib/search";
import { Button, CatalogFilter, EMPTY_FILTER, EmptyState, Icon, IndustryTag, KV, Sheet, StageMark, Tabs, Tag, passGroup, useNarrow, type FilterGroup, type FilterState } from "@/ui";
import { usePlay } from "../play/context";
import { Availability, ProductBody, ProductLink, useOpenMarket, useProductSheet } from "./ProductSheet";
import { canMakeProduct, consumersOf, producersOf, productResearch, recipeResearch, makers, useMine, type BuildingDef, type RecipeDef } from "./model";
import "./catalog.css";

type Tab = "products" | "buildings" | "recipes";
const STAGES = ["raw", "intermediate", "final"] as const;
const STAGE_ORDER: Record<string, number> = { raw: 0, intermediate: 1, final: 2 };

export function CatalogPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const mine = useMine();
  const narrow = useNarrow();
  const { openProduct } = useProductSheet();
  const [tab, setTab] = useState<Tab>("products");
  const [filters, setFilters] = useState<Record<Tab, FilterState>>({ products: EMPTY_FILTER, buildings: EMPTY_FILTER, recipes: EMPTY_FILTER });
  const [sel, setSel] = useState<Record<Tab, string | null>>({ products: null, buildings: null, recipes: null });
  const [sheet, setSheet] = useState<{ tab: Tab; id: string } | null>(null);
  const f = filters[tab];
  const setF = (s: FilterState) => setFilters({ ...filters, [tab]: s });

  const industryOpts = w.industries.map((x) => ({ id: x, label: t(`industry.${x}`), industry: x }));
  const buildingOpts = useMemo(() => {
    const ids = new Set(w.recipes.map((r) => r.buildingType));
    return w.buildingTypes.filter((b) => ids.has(b.id)).map((b) => ({ id: b.id, label: i.name(b.name) })).sort((a, b) => a.label.localeCompare(b.label, i.locale));
  }, [w, i]);
  const researchOpts = [{ id: "none", label: t("catalog.res.none") }, { id: "done", label: t("catalog.res.done") }, { id: "needed", label: t("catalog.res.needed") }];
  const stageOpts = STAGES.map((s) => ({ id: s, label: t(`stage.${s}`) }));

  const groups: FilterGroup[] = tab === "products" ? [
    { id: "industry", label: t("catalog.industry"), options: industryOpts },
    { id: "stage", label: t("catalog.stage"), options: stageOpts },
    { id: "building", label: t("catalog.building"), options: buildingOpts },
    { id: "mine", label: t("catalog.mine"), mode: "all", options: [{ id: "canMake", label: t("catalog.canMake") }, { id: "inStock", label: t("catalog.inStock") }] },
    { id: "research", label: t("catalog.research"), options: researchOpts },
  ] : tab === "buildings" ? [
    { id: "industry", label: t("catalog.industry"), options: industryOpts },
    { id: "tier", label: t("catalog.tierGroup"), options: [1, 2, 3].map((n) => ({ id: String(n), label: t("catalog.tier", { n }) })) },
    { id: "mine", label: t("catalog.mine"), mode: "all", options: [{ id: "owned", label: t("catalog.owned") }, { id: "buildable", label: t("catalog.buildable") }] },
  ] : [
    { id: "industry", label: t("catalog.industry"), options: industryOpts },
    { id: "stage", label: t("catalog.stage"), options: stageOpts },
    { id: "building", label: t("catalog.building"), options: buildingOpts },
    { id: "mine", label: t("catalog.mine"), options: [{ id: "canMake", label: t("catalog.canMake") }] },
    { id: "research", label: t("catalog.research"), options: researchOpts },
  ];

  const indexOf = (x: string | null | undefined) => (x ? w.industries.indexOf(x as Industry) : 99);
  const products = useMemo(() => w.products.filter((p) =>
    matchQuery(f.q, p.name.tr, p.name.en, p.id)
    && passGroup(f, { id: "industry" }, (o) => p.industry === o)
    && passGroup(f, { id: "stage" }, (o) => p.stage === o)
    && passGroup(f, { id: "building" }, (o) => producersOf(w, p.id).some((r) => r.buildingType === o))
    && passGroup(f, { id: "mine", mode: "all" }, (o) => (o === "canMake" ? canMakeProduct(w, p.id, mine) : (mine.stockKg.get(p.id) ?? 0) > 0))
    && passGroup(f, { id: "research" }, (o) => productResearch(w, p.id, mine) === o),
  ).sort((a, b) => indexOf(a.industry) - indexOf(b.industry) || (STAGE_ORDER[a.stage ?? ""] ?? 9) - (STAGE_ORDER[b.stage ?? ""] ?? 9) || i.name(a.name).localeCompare(i.name(b.name), i.locale)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [w, f, mine, i.locale]);
  const buildings = useMemo(() => w.buildingTypes.filter((b) =>
    matchQuery(f.q, b.name.tr, b.name.en, b.description?.tr, b.description?.en, b.id)
    && passGroup(f, { id: "industry" }, (o) => b.industry === o)
    && passGroup(f, { id: "tier" }, (o) => String(b.tier) === o)
    && passGroup(f, { id: "mine", mode: "all" }, (o) => (o === "owned" ? mine.facilities.some((x) => x.type === b.id) : b.minCompanyLevel <= mine.companyLevel)),
  ).sort((a, b) => indexOf(a.industry) - indexOf(b.industry) || a.tier - b.tier || i.name(a.name).localeCompare(i.name(b.name), i.locale)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [w, f, mine, i.locale]);
  const recipes = useMemo(() => w.recipes.filter((r) => {
    const out = w.products.find((p) => p.id === r.output.productId);
    return matchQuery(f.q, r.name.tr, r.name.en, out?.name.tr, out?.name.en, r.id)
      && passGroup(f, { id: "industry" }, (o) => out?.industry === o)
      && passGroup(f, { id: "stage" }, (o) => out?.stage === o)
      && passGroup(f, { id: "building" }, (o) => r.buildingType === o)
      && passGroup(f, { id: "mine" }, () => makers(r, mine).length > 0)
      && passGroup(f, { id: "research" }, (o) => recipeResearch(r, mine) === o);
  }).sort((a, b) => i.name(a.name).localeCompare(i.name(b.name), i.locale)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [w, f, mine, i.locale]);

  const shown = tab === "products" ? products.length : tab === "buildings" ? buildings.length : recipes.length;
  const total = tab === "products" ? w.products.length : tab === "buildings" ? w.buildingTypes.length : w.recipes.length;
  const choose = (id: string) => {
    if (tab === "products" && narrow) { openProduct(id); return; }
    setSel({ ...sel, [tab]: id });
    if (narrow) setSheet({ tab, id });
  };
  const current = sel[tab];

  const list = (() => {
    if (!shown) return <EmptyState icon="box" title={t(`catalog.empty.${tab}`)} text={t("catalog.emptyText")} action={<Button variant="primary" onClick={() => setF(EMPTY_FILTER)}>{t("filter.clear")}</Button>} />;
    if (tab === "products") return (
      <ul className="cat-list" aria-label={t("catalog.tabs.products")}>
        {products.map((p) => {
          const kg = mine.stockKg.get(p.id) ?? 0;
          return (
            <li key={p.id}><button type="button" className="cat-row" aria-pressed={current === p.id && !narrow} onClick={() => choose(p.id)}>
              <StageMark stage={p.stage} /><span className="cat-name">{i.name(p.name)}</span><IndustryTag industry={p.industry} />
              {kg > 0 ? <span className="cat-meta num">{i.qty(kg)}</span> : null}
            </button></li>
          );
        })}
      </ul>
    );
    if (tab === "buildings") return (
      <ul className="cat-list" aria-label={t("catalog.tabs.buildings")}>
        {buildings.map((b) => {
          const own = mine.facilities.filter((x) => x.type === b.id).length;
          return (
            <li key={b.id}><button type="button" className="cat-row" aria-pressed={current === b.id && !narrow} onClick={() => choose(b.id)}>
              <span className="cat-name">{i.name(b.name)}</span><IndustryTag industry={b.industry} /><Tag>{t("catalog.tier", { n: b.tier })}</Tag>
              {own ? <span className="cat-meta">{t("catalog.ownedN", { n: own })}</span> : b.minCompanyLevel > mine.companyLevel ? <span className="cat-meta">{t("common.level")} {b.minCompanyLevel}</span> : null}
            </button></li>
          );
        })}
      </ul>
    );
    return (
      <ul className="cat-list" aria-label={t("catalog.tabs.recipes")}>
        {recipes.map((r) => {
          const out = w.products.find((p) => p.id === r.output.productId);
          return (
            <li key={r.id}><button type="button" className="cat-row" aria-pressed={current === r.id && !narrow} onClick={() => choose(r.id)}>
              <StageMark stage={out?.stage} /><span className="cat-name">{i.name(r.name)}</span><span className="cat-meta">{cat.building(r.buildingType)}</span>
              {r.research ? <Tag tone={recipeResearch(r, mine) === "needed" ? "warn" : "good"} icon={recipeResearch(r, mine) === "needed" ? "alert" : "check"}>{cat.research(r.research.researchId)}</Tag> : null}
            </button></li>
          );
        })}
      </ul>
    );
  })();

  const detail = (id: string | null, t2: Tab, titled: boolean) => {
    if (!id) return <EmptyState icon="doc" title={t("catalog.pick")} text={t("catalog.pickText")} />;
    if (t2 === "products") return <ProductPane id={id} />;
    if (t2 === "buildings") { const b = w.buildingTypes.find((x) => x.id === id); return b ? <BuildingBody b={b} titled={titled} /> : null; }
    const r = w.recipes.find((x) => x.id === id);
    return r ? <RecipeBody r={r} titled={titled} onBuilding={(bid) => { setTab("buildings"); setSel((s) => ({ ...s, buildings: bid })); setSheet(narrow ? { tab: "buildings", id: bid } : null); }} /> : null;
  };

  return (
    <div className="col cat">
      <Tabs label={t("panels.catalog")} value={tab} onChange={(v) => setTab(v as Tab)} items={[{ id: "products", label: t("catalog.tabs.products") }, { id: "buildings", label: t("catalog.tabs.buildings") }, { id: "recipes", label: t("catalog.tabs.recipes") }]} />
      <div className="cat-layout">
        <div className="col cat-main">
          <CatalogFilter key={tab} label={t(`catalog.tabs.${tab}`)} groups={groups} state={f} onChange={setF} shown={shown} total={total} />
          {list}
        </div>
        {!narrow ? <aside className="cat-detail" aria-label={t("catalog.detail")}>{detail(current, tab, true)}</aside> : null}
      </div>
      <Sheet open={narrow && !!sheet} onClose={() => setSheet(null)} wide closeLabel={t("common.close")}
        title={sheet ? (sheet.tab === "buildings" ? cat.building(sheet.id) : cat.recipe(sheet.id)) : ""}
        footer={sheet ? <SheetAction tab={sheet.tab} id={sheet.id} onDone={() => setSheet(null)} /> : undefined}>
        {sheet ? detail(sheet.id, sheet.tab, false) : null}
      </Sheet>
    </div>
  );
}

function ProductPane({ id }: { id: string }) {
  const { t } = useT();
  const cat = useCat();
  const { focusCityId } = usePlay();
  const [city, setCity] = useState<string | null>(null);
  const c = city ?? focusCityId ?? cat.world.cities[0]!.id;
  const openMarket = useOpenMarket();
  return (
    <div className="col">
      <ProductBody id={id} city={c} setCity={setCity} titled />
      <div className="cat-action"><Button variant="primary" size="lg" onClick={() => openMarket(id, c)}><Icon name="chart" size={18} />{t("psheet.openMarket")}</Button></div>
    </div>
  );
}

/** Bina ve tarif ayrıntısında birincil eylem (dar ekranda Sheet altında, geniş ekranda gövdenin sonunda). */
function ActionFor({ tab, id, onDone }: { tab: Tab; id: string; onDone?: () => void }) {
  const { t } = useT();
  const cat = useCat();
  const { open } = usePlay();
  const mine = useMine();
  if (tab === "buildings") return <Button variant="primary" size="lg" onClick={() => { onDone?.(); open(null); }}><Icon name="city" size={18} />{t("catalog.pickPlot")}</Button>;
  const r = cat.world.recipes.find((x) => x.id === id);
  const f = r ? makers(r, mine)[0] : undefined;
  if (!r) return null;
  if (f) return <Button variant="primary" size="lg" onClick={() => { onDone?.(); open("facilities", { params: { facility: f.id, recipe: r.id } }); }}><Icon name="factory" size={18} />{t("catalog.openFacility")}</Button>;
  return <Button variant="primary" size="lg" onClick={() => { onDone?.(); open(null); }}><Icon name="city" size={18} />{t("catalog.pickPlot")}</Button>;
}
function SheetAction(p: { tab: Tab; id: string; onDone: () => void }) { return <ActionFor {...p} />; }

function BuildingBody({ b, titled }: { b: BuildingDef; titled: boolean }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const mine = useMine();
  const rs = cat.world.recipes.filter((r) => r.buildingType === b.id);
  const own = mine.facilities.filter((x) => x.type === b.id);
  const top = b.levels[b.levels.length - 1];
  return (
    <div className="col pd">
      {titled ? <h2 className="pd-h">{i.name(b.name)}</h2> : null}
      <div className="row wrap"><IndustryTag industry={b.industry} /><Tag>{t("catalog.tier", { n: b.tier })}</Tag>{b.minCompanyLevel > 1 ? <Tag tone={b.minCompanyLevel > mine.companyLevel ? "warn" : undefined} icon={b.minCompanyLevel > mine.companyLevel ? "alert" : undefined}>{t("common.level")} {b.minCompanyLevel}</Tag> : null}</div>
      {b.description ? <p className="small muted2">{i.name(b.description)}</p> : null}
      <section className="pd-sec">
        <KV k={t("found.cash")} v={<span className="num">{i.money(b.buildCost)}</span>} />
        <KV k={cat.product("steel")} v={<span className="num">{i.qty(b.buildSteelKg)}</span>} />
        <KV k={t("quote.duration")} v={i.dur(b.buildMinutes)} />
        {top ? <KV k={t("catalog.maxLevel")} v={<span className="num">{t("catalog.levelInfo", { n: top.level, lines: top.lines, batches: top.maxBatches })}</span>} /> : null}
        {b.requiresDeposit ? <KV k={t("found.deposit")} v={b.deposits ? b.deposits.map((d) => t(`deposit.${d}`)).join(", ") : t("catalog.anyDeposit")} /> : null}
        <KV k={t("catalog.ownedLabel")} v={own.length ? t("catalog.ownedN", { n: own.length }) : t("common.none")} />
      </section>
      <section className="pd-sec">
        <h4>{t("catalog.recipesOf")}</h4>
        {rs.length ? (
          <ul className="pd-list">{rs.map((r) => (
            <li key={r.id} className="pd-item">
              <div className="row between"><b>{cat.recipe(r.id)}</b><span className="small muted2">{i.dur(r.minutes)}</span></div>
              <span className="small muted2">{r.inputs.length ? r.inputs.map((x, n) => <span key={x.productId}>{n ? " + " : ""}{i.qty(x.kg)} <ProductLink id={x.productId} /></span>) : t("decide.recipes.noInputs")} → {i.qty(r.output.kg)} <ProductLink id={r.output.productId} /></span>
              <Availability r={r} mine={mine} />
            </li>
          ))}</ul>
        ) : <span className="small muted2">{t("catalog.noRecipes")}</span>}
      </section>
      {titled ? <div className="cat-action"><ActionFor tab="buildings" id={b.id} /></div> : null}
    </div>
  );
}

function RecipeBody({ r, titled, onBuilding }: { r: RecipeDef; titled: boolean; onBuilding: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const mine = useMine();
  const out = cat.world.products.find((p) => p.id === r.output.productId);
  const used = consumersOf(cat.world, r.output.productId).length;
  return (
    <div className="col pd">
      {titled ? <h2 className="pd-h"><StageMark stage={out?.stage} />{i.name(r.name)}</h2> : null}
      <div className="row wrap"><IndustryTag industry={out?.industry} /><button type="button" className="link-btn" onClick={() => onBuilding(r.buildingType)}>{cat.building(r.buildingType)}</button></div>
      <section className="pd-sec">
        <KV k={t("decide.recipes.inputs")} v={r.inputs.length ? <span className="col tight" style={{ alignItems: "flex-end", gap: 2 }}>{r.inputs.map((x) => <span key={x.productId}>{i.qty(x.kg)} <ProductLink id={x.productId} /></span>)}</span> : t("decide.recipes.noInputs")} />
        <KV k={t("decide.recipes.output")} v={<span>{i.qty(r.output.kg)} <ProductLink id={r.output.productId} /></span>} />
        <KV k={t("decide.recipes.duration")} v={i.dur(r.minutes)} />
        <KV k={t("quote.energy")} v={`${i.num(r.energyKwh)} kWh`} />
        <KV k={t("quote.water")} v={`${i.num(r.waterM3)} m³`} />
        <KV k={t("quote.labor")} v={`${i.num(r.laborHours)} ${t("found.hour")}`} />
        {r.minBuildingLevel > 1 ? <KV k={t("catalog.minBuildingLevel")} v={r.minBuildingLevel} /> : null}
        {r.deposit ? <KV k={t("found.deposit")} v={t(`deposit.${r.deposit}`)} /> : null}
        {used ? <KV k={t("catalog.usedIn")} v={t("catalog.recipesN", { n: used })} /> : null}
      </section>
      <section className="pd-sec"><h4>{t("psheet.status")}</h4><Availability r={r} mine={mine} /></section>
      {titled ? <div className="cat-action"><ActionFor tab="recipes" id={r.id} /></div> : null}
    </div>
  );
}
