"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useCat } from "@/lib/catalog";
import { useT } from "@/lib/i18n";
import { Button, Icon, IndustryTag, KV, SelectField, Sheet, StageMark, SystemBadge, Tag } from "@/ui";
import { MarketQuote } from "../market/MarketStats";
import { usePlay } from "../play/context";
import { availability, consumersOf, producersOf, useMine, type Mine, type RecipeDef } from "./model";
import "./catalog.css";

interface Ctx { openProduct: (id: string) => void }
const C = createContext<Ctx>({ openProduct: () => undefined });
export const useProductSheet = (): Ctx => useContext(C);

/** Ürün adı: dokununca ürün sayfası (Sheet) açılır. Gerçek düğme; Enter/Space çalışır. */
export function ProductLink({ id, children, className }: { id: string; children?: ReactNode; className?: string }) {
  const { openProduct } = useProductSheet();
  const cat = useCat();
  return <button type="button" className={`link-btn ${className ?? ""}`} onClick={(e) => { e.stopPropagation(); openProduct(id); }}>{children ?? cat.product(id)}</button>;
}

export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const openProduct = useCallback((p: string) => setId(p), []);
  const v = useMemo(() => ({ openProduct }), [openProduct]);
  return <C.Provider value={v}>{children}<ProductSheet id={id} onClose={() => setId(null)} /></C.Provider>;
}

/** "Pazarı aç": pazar paneli ürün ve şehir seçili açılır. */
export function useOpenMarket() {
  const { open } = usePlay();
  return useCallback((product: string, city: string, side: "buy" | "sell" = "buy") => open("market", { params: { product, city, side } }), [open]);
}

function ProductSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT();
  const cat = useCat();
  const { focusCityId } = usePlay();
  const [cityPick, setCity] = useState<string | null>(null);
  const city = cityPick ?? focusCityId ?? cat.world.cities[0]!.id;
  const openMarket = useOpenMarket();
  const p = id ? cat.world.products.find((x) => x.id === id) : null;
  return (
    <Sheet open={!!p} onClose={onClose} wide closeLabel={t("common.close")}
      title={p ? <span className="pd-title"><StageMark stage={p.stage} />{cat.product(p.id)}</span> : ""}
      footer={p ? <Button variant="primary" size="lg" onClick={() => { onClose(); openMarket(p.id, city); }}><Icon name="chart" size={18} />{t("psheet.openMarket")}</Button> : undefined}>
      {p ? <ProductBody id={p.id} city={city} setCity={setCity} /> : null}
    </Sheet>
  );
}

export function Availability({ r, mine }: { r: RecipeDef; mine: Mine }) {
  const { t } = useT();
  const cat = useCat();
  const { open } = usePlay();
  const a = availability(cat.world, r, mine);
  const where = [...new Set(a.facilities.map((f) => cat.city(f.cityId)))].slice(0, 2).join(", ");
  return (
    <span className="col tight pd-avail">
      {a.kind === "installed" ? <Tag tone="good" icon="check">{t("psheet.installed")}{where ? ` · ${where}` : ""}</Tag> : null}
      {a.kind === "buildable" ? <Tag tone="steel" icon="plus">{t("psheet.buildable")}</Tag> : null}
      {a.kind === "locked" ? <Tag tone="warn" icon="alert">{t("psheet.locked")}</Tag> : null}
      {a.gate && !a.gate.met ? (
        <span className="small warn">{t("psheet.needResearch", { name: cat.research(a.gate.researchId), n: a.gate.need })} <span className="muted2">({a.gate.have}/{a.gate.need})</span>{" "}
          <button type="button" className="link-btn" onClick={() => open("research", { params: { focus: a.gate!.researchId } })}>{t("psheet.goResearch")}</button></span>
      ) : null}
      {a.ownedLowLevel ? <span className="small warn">{t("decide.recipes.locked", { n: r.minBuildingLevel })}</span> : null}
      {a.needCompanyLevel ? <span className="small warn">{t("errors.LEVEL_TOO_LOW")} ({t("common.level")} {a.needCompanyLevel})</span> : null}
    </span>
  );
}

function Inputs({ r }: { r: RecipeDef }) {
  const i = useT();
  if (!r.inputs.length) return <span className="small muted2">{i.t("decide.recipes.noInputs")}</span>;
  return <span className="small muted2">{r.inputs.map((x, n) => <span key={x.productId}>{n ? " + " : ""}{i.qty(x.kg)} <ProductLink id={x.productId} /></span>)}</span>;
}

export function ProductBody({ id, city, setCity, titled }: { id: string; city: string; setCity: (c: string) => void; titled?: boolean }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const mine = useMine();
  const p = w.products.find((x) => x.id === id)!;
  const makeRecipes = producersOf(w, id);
  const useRecipes = consumersOf(w, id);
  const buyers = w.systemDemand.filter((d) => d.productId === id && d.side === "buy").sort((a, b) => b.dailyKg - a.dailyKg);
  const sellers = w.systemDemand.filter((d) => d.productId === id && d.side === "sell").sort((a, b) => b.dailyKg - a.dailyKg);
  const stock = mine.stockKg.get(id) ?? 0;
  const stockCities = mine.stockCities.get(id) ?? [];
  return (
    <div className="col pd">
      {titled ? <h2 className="pd-h"><StageMark stage={p.stage} />{cat.product(id)}</h2> : null}
      <div className="row wrap">
        <IndustryTag industry={p.industry} />
        {p.stage ? <Tag>{t(`stage.${p.stage}`)}</Tag> : null}
        <span className="small muted2">{t("psheet.basePrice")}: <b className="num">{i.price(p.basePricePerKg)}</b></span>
      </div>

      <section className="pd-sec" aria-labelledby={`pd-stock-${id}`}>
        <h4 id={`pd-stock-${id}`}>{t("psheet.stock")}</h4>
        {stock > 0 ? (
          <>
            <KV k={t("inventory.available")} v={<b className="num">{i.qty(stock)}</b>} />
            <span className="small muted2">{stockCities.slice(0, 3).map(([c, kg]) => `${cat.city(c)} ${i.qty(kg)}`).join(" · ")}{stockCities.length > 3 ? ` · +${stockCities.length - 3}` : ""}</span>
          </>
        ) : <span className="small muted2">{t("psheet.noStock")}</span>}
      </section>

      <section className="pd-sec" aria-labelledby={`pd-make-${id}`}>
        <h4 id={`pd-make-${id}`}>{t("psheet.makeWhere")}</h4>
        {makeRecipes.length ? (
          <ul className="pd-list">
            {makeRecipes.map((r) => (
              <li key={r.id} className="pd-item">
                <div className="row between"><b>{cat.recipe(r.id)}</b><span className="small muted2">{cat.building(r.buildingType)} · {i.dur(r.minutes)}</span></div>
                <span className="small muted2">{t("psheet.output")}: {i.qty(r.output.kg)}</span>
                <Inputs r={r} />
                <Availability r={r} mine={mine} />
              </li>
            ))}
          </ul>
        ) : <span className="small muted2">{t("psheet.noRecipe")}</span>}
      </section>

      <section className="pd-sec" aria-labelledby={`pd-use-${id}`}>
        <h4 id={`pd-use-${id}`}>{t("psheet.usedWhere")}</h4>
        {useRecipes.length ? (
          <ul className="pd-list">
            {useRecipes.slice(0, 12).map((r) => {
              const inp = r.inputs.find((x) => x.productId === id)!;
              return (
                <li key={r.id} className="pd-item">
                  <div className="row between"><b>{cat.recipe(r.id)}</b><span className="small muted2">{cat.building(r.buildingType)}</span></div>
                  <span className="small muted2">{i.qty(inp.kg)} → <ProductLink id={r.output.productId} /> {i.qty(r.output.kg)}</span>
                </li>
              );
            })}
            {useRecipes.length > 12 ? <li className="small muted2">{t("psheet.more", { n: useRecipes.length - 12 })}</li> : null}
          </ul>
        ) : <span className="small muted2">{t("psheet.noUse")}</span>}
        <h5 className="pd-sub">{t("psheet.sysBuyers")}</h5>
        {buyers.length ? (
          <ul className="pd-list tight">
            {buyers.map((d, n) => <li key={n} className="row between pd-sys"><span className="row">{cat.city(d.cityId)} <SystemBadge /></span><span className="num small">{t("psheet.perDay", { q: i.qty(d.dailyKg) })}</span></li>)}
          </ul>
        ) : <span className="small muted2">{t("psheet.noSysBuyers")}</span>}
        {sellers.length ? (
          <>
            <h5 className="pd-sub">{t("psheet.sysSellers")}</h5>
            <ul className="pd-list tight">{sellers.map((d, n) => <li key={n} className="row between pd-sys"><span className="row">{cat.city(d.cityId)} <SystemBadge /></span><span className="num small">{t("psheet.perDay", { q: i.qty(d.dailyKg) })}</span></li>)}</ul>
          </>
        ) : null}
      </section>

      <section className="pd-sec" aria-labelledby={`pd-mkt-${id}`}>
        <h4 id={`pd-mkt-${id}`}>{t("psheet.market")}</h4>
        <SelectField label={t("mstat.city")} value={city} onChange={setCity} options={w.cities.map((c) => ({ id: c.id, label: cat.city(c.id) }))} />
        <MarketQuote productId={id} cityId={city} compact />
      </section>
    </div>
  );
}
