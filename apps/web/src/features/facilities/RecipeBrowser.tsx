"use client";
import type { FacilityDto, ProductionJobDto, ProductionQuoteDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { setMarketIntent } from "@/lib/intent";
import { Button, Icon, Table, Tag, Trend, type Col } from "@/ui";
import { ProductLink } from "../catalog/ProductSheet";
import { gateOf, type Mine, type RecipeDef } from "../catalog/model";
import { usePlay } from "../play/context";

export type QuoteState = { q: ProductionQuoteDto } | { err: string };

/** Tahminin hangi alıcıya, navlunla mı yapıldığı. */
export function SaleWhere({ est, cityId }: { est: NonNullable<ProductionQuoteDto["estimate"]>; cityId: string }) {
  const i = useT();
  const cat = useCat();
  if (est.cityId === cityId) return <span className="xs muted">{i.t("decide.recipes.sellHere")}</span>;
  return <span className="xs muted">{i.t("decide.recipes.sellAt", { city: cat.city(est.cityId) })} · {i.t("decide.recipes.freightIncl", { a: i.money(est.freight, true) })}</span>;
}

/** Tarif kilidi: araştırma (adıyla) ya da bina seviyesi. */
export function lockOf(r: RecipeDef, f: FacilityDto, mine: Mine): { research: ReturnType<typeof gateOf>; level: number | null } | null {
  const g = gateOf(r, mine);
  const research = g && !g.met ? g : null;
  const level = r.minBuildingLevel > f.level ? r.minBuildingLevel : null;
  return research || level ? { research, level } : null;
}

/** Binanın tüm tarifleri: başlatılabilirler tahmini kârla tabloda; kilitliler araştırma adıyla ayrı listede. Eksik girdide "Eksik X kg al", tamamlanan üretimde "Sat". */
export function RecipeBrowser({ f, recipes, quotes, recipeId, onSelect, bestId, mine, onBuyMissing }: {
  f: FacilityDto; recipes: RecipeDef[]; quotes: Record<string, QuoteState>; recipeId: string; onSelect: (id: string) => void; bestId: string | null; mine: Mine; onBuyMissing: (productId: string, qtyKg: number) => void;
}) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const open_ = recipes.filter((r) => !lockOf(r, f, mine));
  const locked = recipes.filter((r) => lockOf(r, f, mine));
  const lastDone = (r: RecipeDef): ProductionJobDto | undefined => f.jobs.filter((j) => j.status === "completed" && j.recipeId === r.id).sort((a, b) => (b.completedAt ?? b.endsAt).localeCompare(a.completedAt ?? a.endsAt))[0];
  const sell = (j: ProductionJobDto, r: RecipeDef) => {
    setMarketIntent({ productId: j.output.productId, cityId: f.cityId, side: "sell", quality: j.output.quality, qtyKg: j.output.qtyKg, returnTo: { facilityId: f.id, name: cat.building(f.type), recipeId: r.id } });
    open("market", { params: { side: "sell", product: j.output.productId, city: f.cityId, quality: String(j.output.quality), qty: String(j.output.qtyKg) } });
  };
  const cols: Col<RecipeDef>[] = [
    { key: "p", head: t("decide.recipes.product"), lead: true, bare: true, cell: (r) => {
      const done = lastDone(r);
      return (
        <span className="ops-recipe-name"><i className="ops-radio" aria-hidden="true" /><span className="trade-swatch" style={{ backgroundColor: cat.productColor(r.output.productId) }} aria-hidden="true" />
          <span className="col tight" style={{ gap: 0, minWidth: 0 }}><b>{cat.product(r.output.productId)}</b><span className="xs muted2">{cat.recipe(r.id)}</span>
            {done ? <Button size="sm" className="rb-fix" onClick={(e) => { e.stopPropagation(); sell(done, r); }}><Icon name="chart" size={15} />{t("rb.sellLast", { q: i.qty(done.output.qtyKg) })}</Button> : null}
          </span>{r.id === bestId ? <Tag tone="forge" icon="star">{t("offers.best")}</Tag> : null}</span>
      );
    } },
    { key: "i", head: t("decide.recipes.inputs"), cell: (r) => {
      const st = quotes[r.id]; const rq = st && "q" in st ? st.q : null;
      if (!rq) return st ? <span className="xs warn">{t("decide.recipes.cantStart")}</span> : <span className="muted">…</span>;
      if (!rq.inputs.length) return <span className="xs muted2">{t("decide.recipes.noInputs")}</span>;
      return <span className="col tight" style={{ gap: 2 }}>{rq.inputs.map((x) => {
        const short = x.requiredKg - x.availableKg;
        return (
          <span key={x.productId} className="ops-input-cell"><span className="nm">{cat.product(x.productId)}</span> <span className="num">{i.qty(Math.min(x.availableKg, 1e12))} / {i.qty(x.requiredKg)}</span>
            {short > 0
              ? <><b className="bad xs"> · {t("decide.recipes.missing", { q: i.qty(short) })}</b> <Button size="sm" className="rb-fix" onClick={(e) => { e.stopPropagation(); onBuyMissing(x.productId, short); }}><Icon name="chart" size={15} />{t("decide.recipes.buyMissing", { q: i.qty(short), product: cat.product(x.productId) })}</Button></>
              : <span className="good xs" aria-label={t("decide.recipes.ready")}> ✓</span>}
          </span>
        );
      })}</span>;
    } },
    { key: "d", head: t("decide.recipes.duration"), right: true, nowrap: true, cell: (r) => { const st = quotes[r.id]; return st && "q" in st ? <span className="num">{i.dur(st.q.minutes)}</span> : <span className="muted">—</span>; } },
    { key: "o", head: t("decide.recipes.output"), right: true, nowrap: true, cell: (r) => { const st = quotes[r.id]; return st && "q" in st ? <span className="num">{i.qty(st.q.output.qtyKg)} <span className="muted xs">★{st.q.output.quality}</span></span> : <span className="muted">—</span>; } },
    { key: "c", head: t("decide.recipes.cost"), right: true, nowrap: true, cell: (r) => { const st = quotes[r.id]; return st && "q" in st ? <span className="num">{i.money(st.q.cost.total)}</span> : <span className="muted">—</span>; } },
    { key: "k", head: t("decide.recipes.profit"), right: true, nowrap: true, cell: (r) => {
      const st = quotes[r.id]; const e = st && "q" in st ? st.q.estimate : null;
      if (!st || !("q" in st)) return <span className="muted">—</span>;
      if (!e) return <span className="muted xs">{t("facility.noEstimate")}</span>;
      return <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><Trend value={e.profit} text={i.signed(e.profit)} /><SaleWhere est={e} cityId={f.cityId} /></span>;
    } },
    { key: "h", head: t("decide.recipes.perHour"), right: true, nowrap: true, cell: (r) => { const st = quotes[r.id]; const e = st && "q" in st ? st.q.estimate : null; return e ? <span className="num">{i.signed(e.profitPerHour)}</span> : <span className="muted">—</span>; } },
  ];
  return (
    <>
      {open_.length ? (
        <Table<RecipeDef> className="ops-compare" cols={cols} rows={open_} rowKey={(r) => r.id} onRow={(r) => onSelect(r.id)} rowSelected={(r) => r.id === recipeId}
          rowLabel={(r) => `${cat.product(r.output.productId)} · ${cat.recipe(r.id)}`} rowClass={(r) => (r.id === bestId ? "best" : "")} />
      ) : null}
      <LockedRecipes f={f} recipes={locked} mine={mine} />
    </>
  );
}

/** Kilitli tarifler: neden kilitli (araştırma adı ve seviyesi, bina seviyesi) ve oraya götüren düğme. */
export function LockedRecipes({ f, recipes, mine }: { f: FacilityDto; recipes: RecipeDef[]; mine: Mine }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  if (!recipes.length) return null;
  return (
    <section className="col tight" aria-label={t("rb.locked", { n: recipes.length })}>
      <h4 className="ops-section-title"><Icon name="alert" size={18} />{t("rb.locked", { n: recipes.length })}</h4>
      <ul className="pd-list">
        {recipes.map((r) => {
          const lk = lockOf(r, f, mine)!;
          return (
            <li key={r.id} className="pd-item rb-lock">
              <div className="row between"><b>{cat.product(r.output.productId)}</b><span className="small muted2">{cat.recipe(r.id)} · {i.dur(r.minutes)}</span></div>
              <span className="small muted2">{r.inputs.length ? r.inputs.map((x, n) => <span key={x.productId}>{n ? " + " : ""}{i.qty(x.kg)} <ProductLink id={x.productId} /></span>) : t("decide.recipes.noInputs")}</span>
              {lk.research ? (
                <span className="row wrap"><Tag tone="warn" icon="alert">{t("psheet.needResearch", { name: cat.research(lk.research.researchId), n: lk.research.need })} ({lk.research.have}/{lk.research.need})</Tag>
                  <Button size="sm" onClick={() => open("research", { params: { focus: lk.research!.researchId } })}><Icon name="flask" size={15} />{t("psheet.goResearch")}</Button></span>
              ) : null}
              {lk.level ? <span><Tag tone="warn" icon="alert">{t("decide.recipes.locked", { n: lk.level })}</Tag></span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
