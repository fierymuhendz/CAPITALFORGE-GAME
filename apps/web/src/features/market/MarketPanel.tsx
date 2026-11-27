"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BuyResultDto, HaulResultDto, HoldingDto, OfferNote, OfferRowDto, OffersDto, VehicleDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useDebounced } from "@/lib/debounce";
import { setShipIntent, takeMarketIntent, type MarketIntent } from "@/lib/intent";
import { useT, type I18n } from "@/lib/i18n";
import { Async, Button, Disclosure, EmptyState, Icon, KV, ProductPicker, QtyInput, SelectField, Sheet, SkeletonList, SystemBadge, Table, Tabs, Tag, Trend, type Col } from "@/ui";
import { useProductSheet } from "../catalog/ProductSheet";
import { usePlay } from "../play/context";
import { MarketStatsBlock, RouteNetTable } from "./MarketStats";
import { Board, CreateSheet, type View } from "./MarketBoard";

import "./trade.css";

type Tab = "buy" | "sell" | "board";

export function MarketPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { open } = usePlay();
  const { openProduct } = useProductSheet();
  const [tab, setTab] = useState<Tab>("buy");
  const [productId, setProductId] = useState(cat.world.products[0]!.id);
  const [toCity, setToCity] = useState(me?.company?.homeCityId ?? cat.world.cities[0]!.id);
  const [fromCity, setFromCity] = useState<string | null>(null);
  const [sellQuality, setSellQuality] = useState<number | null>(null);
  const [qtyBuy, setQtyBuy] = useState<number | null>(1000);
  const [qtySell, setQtySell] = useState<number | null>(null);
  const [create, setCreate] = useState<"sell" | "buy" | null>(null);
  const [returnTo, setReturnTo] = useState<MarketIntent["returnTo"] | null>(null);
  const [sold, setSold] = useState<SoldInfo | null>(null);
  const sp = useSearchParams();
  useEffect(() => {
    // URL (yenilemede korunur) yoksa bellek içi niyet
    const up = sp.get("product");
    const fromUrl: MarketIntent | null = up && cat.world.products.some((p) => p.id === up)
      ? { productId: up, cityId: sp.get("city") ?? me?.company?.homeCityId ?? cat.world.cities[0]!.id, side: sp.get("side") === "sell" ? "sell" : "buy", quality: sp.get("quality") ? Number(sp.get("quality")) : undefined, qtyKg: sp.get("qty") ? Number(sp.get("qty")) : undefined }
      : null;
    const mem = takeMarketIntent();
    const it = mem ?? fromUrl;
    if (!it) return;
    setProductId(it.productId);
    setReturnTo(it.returnTo ?? null);
    if (it.side === "sell") {
      setTab("sell");
      setFromCity(it.cityId);
      setSellQuality(it.quality ?? null);
      if (it.qtyKg !== undefined && it.qtyKg > 0) setQtySell(it.qtyKg);
    } else {
      setToCity(it.cityId);
      if (it.qtyKg !== undefined && it.qtyKg > 0) setQtyBuy(it.qtyKg);
    }
  }, [sp.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const inv = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  const held = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of inv.data ?? []) m.set(h.productId, (m.get(h.productId) ?? 0) + h.availableKg);
    return m;
  }, [inv.data]);
  const sellProducts = cat.world.products.filter((p) => (held.get(p.id) ?? 0) > 0);
  const prodId = tab === "sell" && sellProducts.length && !sellProducts.some((p) => p.id === productId) ? sellProducts[0]!.id : productId;
  const stockCities = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of inv.data ?? []) if (h.productId === prodId && h.availableKg > 0) m.set(h.cityId, (m.get(h.cityId) ?? 0) + h.availableKg);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inv.data, prodId]);
  const from = fromCity && stockCities.some(([c]) => c === fromCity) ? fromCity : stockCities[0]?.[0] ?? null;
  const lots = (inv.data ?? [])
    .filter((h) => h.productId === prodId && h.cityId === from && h.availableKg > 0)
    .sort((a, b) => b.quality - a.quality);
  const lot = lots.find((h) => h.quality === sellQuality) ?? lots[0];
  const stockKg = lot?.availableKg ?? 0;
  const pick = (id: string) => { setProductId(id); setSellQuality(null); setQtySell(null); setFromCity(null); };
  const sellQty = qtySell !== null ? Math.min(qtySell, stockKg) : stockKg;
  const chips = tab === "sell" ? sellProducts : cat.world.products;
  const createView: View = { productId: prodId, cityId: tab === "sell" ? from ?? toCity : toCity };

  return (
    <div className="col trade-desk">
      {returnTo ? <Button className="trade-return" variant="ghost" size="sm" onClick={() => open("facilities", { params: { facility: returnTo.facilityId, recipe: returnTo.recipeId } })}><Icon name="back" size={16} />{t("decide.back.facility", { name: returnTo.name })}</Button> : null}
      <Tabs label={t("panels.market")} value={tab} onChange={(v) => setTab(v as Tab)} items={[{ id: "buy", label: t("offers.tabBuy") }, { id: "sell", label: t("offers.tabSell") }, { id: "board", label: t("offers.tabBoard") }]} />
      {tab === "board" ? <Board /> : (
        <>
          {chips.length ? (
            <div className="trade-pick">
              <ProductPicker label={t("inventory.product")} value={prodId} onChange={pick} products={chips} extra={tab === "sell" ? (p) => i.qty(held.get(p.id) ?? 0) : undefined} />
              <Button onClick={() => openProduct(prodId)}><Icon name="doc" size={16} />{t("psheet.info")}</Button>
            </div>
          ) : null}
          {tab === "sell" && !inv.data ? <Async res={inv}>{() => null}</Async> : tab === "sell" && !chips.length ? (
            <EmptyState icon="box" title={t("offers.noStockTitle")} text={t("offers.noStockText")} action={<div className="row wrap"><Button variant="primary" onClick={() => open("facilities")}>{t("inventory.goProduce")}</Button><Button onClick={() => setTab("buy")}>{t("offers.tabBuy")}</Button></div>} />
          ) : (
            <>
              <div className="trade-parameters">
                {tab === "buy" ? (
                  <SelectField label={t("offers.deliverTo")} value={toCity} onChange={setToCity} options={cat.world.cities.map((c) => ({ id: c.id, label: cat.city(c.id) }))} />
                ) : (
                  <SelectField label={t("offers.stockIn")} value={from ?? ""} onChange={(v) => { setFromCity(v); setSellQuality(null); setQtySell(null); }} options={stockCities.map(([c, kg]) => ({ id: c, label: `${cat.city(c)} — ${i.qty(kg)}` }))} />
                )}
                {tab === "sell" && lots.length > 1 ? (
                  <SelectField label={t("common.quality")} value={String(lot?.quality)} onChange={(v) => { setSellQuality(Number(v)); setQtySell(null); }}
                    options={lots.map((h) => ({ id: String(h.quality), label: `★ ${h.quality} · ${i.qty(h.availableKg)}` }))} />
                ) : null}
                {tab === "buy"
                  ? <QtyInput label={t("market.qty")} value={qtyBuy} onChange={setQtyBuy} />
                  : <QtyInput label={t("market.qty")} value={sellQty} onChange={setQtySell} max={stockKg} />}
              </div>
              <Offers key={`${tab}-${prodId}-${tab === "sell" ? lot?.quality : ""}`} side={tab} quality={tab === "sell" ? lot?.quality : undefined} productId={prodId} cityId={tab === "buy" ? toCity : from} fromCityId={tab === "sell" ? from : null} qtyKg={tab === "buy" ? qtyBuy : sellQty} onCreate={setCreate} onSold={setSold} />
              <Disclosure summary={t("mstat.title")} open>
                <div className="col">
                  {tab === "sell" && from && sellQty > 0 ? <RouteNetTable key={`${prodId}-${from}-${lot?.quality}`} productId={prodId} qtyKg={sellQty} quality={lot?.quality} fromCityId={from} /> : null}
                  <MarketStatsBlock key={`${prodId}-${tab}`} productId={prodId} cityId={tab === "buy" ? toCity : from ?? toCity} />
                </div>
              </Disclosure>
            </>
          )}
        </>
      )}
      <CreateSheet side={create} onClose={() => setCreate(null)} view={createView} refPrice={null} />
      <SoldSheet sold={sold} onClose={() => setSold(null)} />
    </div>
  );
}

function noteTag(i: I18n, n: OfferNote, r: OfferRowDto) {
  const { t } = i;
  switch (n) {
    case "PARTIAL": return <Tag key={n} tone="warn" icon="alert" title={t("offers.notes.partialHint", { a: i.qty(r.fillKg), b: i.qty(r.availableKg) })}>{t("offers.notes.partial")}</Tag>;
    case "SPLIT_LOADS": return <Tag key={n} tone="steel" icon="split" title={t("offers.notes.splitHint", { n: r.loads, cap: i.qty(r.truckCapacityKg) })}>{t("offers.notes.split", { n: r.loads })}</Tag>;
    case "SAME_CITY": return <Tag key={n} icon="city" title={t("offers.notes.sameCityHint")}>{t("offers.notes.sameCity")}</Tag>;
    case "NO_STOCK": return <Tag key={n} tone="warn" icon="box" title={t("offers.notes.noStockHint")}>{t("offers.notes.noStock")}</Tag>;
    case "QUALITY_PREMIUM": return <Tag key={n} tone="good" icon="star" title={t("offers.notes.qualityHint")}>{t("offers.notes.quality")}</Tag>;
    case "SATURATING": return <Tag key={n} tone="warn" icon="alert" title={t("offers.notes.saturatingHint")}>{t("offers.notes.saturating")}</Tag>;
  }
}

function Offers({ side, productId, cityId, fromCityId, qtyKg, quality, onCreate, onSold }: { side: "buy" | "sell"; productId: string; cityId: string | null; fromCityId: string | null; quality?: number; qtyKg: number | null; onCreate: (s: "sell" | "buy") => void; onSold: (s: SoldInfo) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const q = useDebounced(qtyKg, 350);
  const valid = !!cityId && !!q && q > 0 && q <= 10_000_000;
  const res = useData<OffersDto>(valid ? "/market/offers" : null, { side, productId, cityId, qtyKg: q, fromCityId, quality }, ["market", "inventory"]);
  const [buy, setBuy] = useState<OfferRowDto | null>(null);
  const [sell, setSell] = useState<OfferRowDto | null>(null);
  const [haul, setHaul] = useState<OfferRowDto | null>(null);
  if (!qtyKg || qtyKg < 0 || qtyKg > 10_000_000) return <p className="muted small" role="status">{t("offers.enterQty")}</p>;
  if (!valid || q !== qtyKg) return <SkeletonList n={2} />;
  return (
    <Async res={res}>
      {(d) => {
        if (d.side !== side || d.productId !== productId || d.cityId !== cityId || d.qtyKg !== q) return <SkeletonList n={2} />;
        const same = (r: OfferRowDto) => r.notes.includes("SAME_CITY");
        const best = d.rows.find((r) => r.orderId === d.bestOrderId && !r.notes.includes("NO_STOCK"));
        const who: Col<OfferRowDto> = { key: "w", head: side === "buy" ? t("offers.seller") : t("offers.buyer"), lead: true, cell: (r) => {
          const tags = [r.orderId === d.bestOrderId ? <Tag key="b" tone="forge" icon="star">{t("offers.best")}</Tag> : null, r.orderId === d.fastestOrderId ? <Tag key="f" tone="good" icon="bolt">{t("offers.fastest")}</Tag> : null, ...r.notes.filter((n) => n !== "SAME_CITY" || side === "sell").map((n) => noteTag(i, n, r))].filter(Boolean);
          return (
            <span className="col tight" style={{ gap: 4, minWidth: 0 }}>
              <span className="row" style={{ minWidth: 0 }}><b className="nm" title={r.companyName}>{r.companyName}</b>{r.isSystem ? <SystemBadge /> : null}<span className="trade-quality" aria-label={`${t("common.quality")} ${r.quality}`}>★ {r.quality}</span></span>
              {tags.length ? <span className="tags">{tags}</span> : null}
            </span>
          );
        } };
        const city: Col<OfferRowDto> = { key: "c", head: t("offers.city"), nowrap: true, cell: (r) => <span>{cat.city(r.cityId)}{same(r) ? "" : ` · ${r.km} km`}</span> };
        const qty: Col<OfferRowDto> = { key: "q", head: t("market.qty"), right: true, nowrap: true, cell: (r) => <span className="num">{i.qty(r.fillKg)}{r.fillKg < r.availableKg ? <span className="muted xs"> / {i.qty(r.availableKg)}</span> : null}</span> };
        const eta: Col<OfferRowDto> = { key: "e", head: side === "buy" ? t("offers.arrives") : t("offers.paidIn"), nowrap: true, cell: (r) => <span className="num">{same(r) ? t("offers.now") : i.dur(r.etaMinutes)}</span> };
        const cols: Col<OfferRowDto>[] = side === "buy" ? [
          who, city, qty,
          { key: "p", head: t("offers.deliveredPerT"), right: true, nowrap: true, cell: (r) => <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><b className="num">{i.price(r.perKg)}</b><span className="muted xs num">{t("offers.total")} {i.money(r.total)}</span></span> },
          eta,
          { key: "a", head: "", bare: true, act: true, cell: (r) => <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setBuy(r); }}>{t("market.buy")}</Button> },
        ] : [
          who, city, qty,
          { key: "p", head: t("decide.sell.price"), right: true, nowrap: true, cell: (r) => <span className="num">{i.price(r.pricePerKg)}</span> },
          { key: "x", head: t("decide.sell.costs"), right: true, nowrap: true, cell: (r) => <span className="num muted2">− {i.money((BigInt(r.fee) + BigInt(r.freight)).toString())}</span> },
          { key: "n", head: t("decide.sell.net"), right: true, nowrap: true, cell: (r) => <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><b className="num">{i.money(r.total)}</b><span className="muted xs num">{i.price(r.perKg)}</span></span> },
          { key: "k", head: t("decide.sell.profit"), right: true, nowrap: true, cell: (r) => r.profit !== null ? <Trend value={r.profit} text={i.signed(r.profit)} /> : <span className="muted">—</span> },
          eta,
          { key: "a", head: "", bare: true, act: true, cell: (r) => r.notes.includes("NO_STOCK") ? <span className="muted xs">—</span>
            : same(r) ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setSell(r); }}>{t("market.sell")}</Button>
            : <Button size="sm" onClick={(e) => { e.stopPropagation(); setHaul(r); }}><Icon name="truck" size={15} />{t("decide.sell.ship", { city: cat.city(r.cityId) })}</Button> },
        ];
        return (
          <div className="col">
            {best ? (
              <section className="trade-quote" aria-label={`${t("offers.best")} · ${best.companyName}`}>
                <div className="trade-quote-title">
                  <span className="trade-quote-icon"><Icon name={side === "buy" ? "down" : "up"} size={20} /></span>
                  <div><span className="trade-label">{t("offers.best")} · {t(side === "buy" ? "offers.seller" : "offers.buyer")}</span><strong>{best.companyName}</strong><small>{cat.city(best.cityId)} · {t("common.quality")} {best.quality}</small></div>
                </div>
                <dl className="trade-quote-numbers">
                  <div><dt>{t(side === "buy" ? "offers.deliveredPerT" : "offers.netPerT")}</dt><dd>{i.price(best.perKg)}</dd></div>
                  <div><dt>{t("market.qty")}</dt><dd>{i.qty(best.fillKg)}</dd></div>
                  <div><dt>{t(side === "buy" ? "offers.total" : "offers.youReceive")}</dt><dd>{i.money(best.total)}</dd></div>
                  {side === "sell" && best.profit !== null ? <div><dt>{t("decide.sell.bestProfit")}</dt><dd><Trend value={best.profit} text={i.signed(best.profit)} /></dd></div> : null}
                </dl>
                <div className="trade-quote-act">{side === "buy" ? <Button variant="primary" onClick={() => setBuy(best)}>{t("market.buy")} · {i.money(best.total)}</Button> : same(best) ? <Button variant="primary" onClick={() => setSell(best)}>{t("offers.sellNow", { q: i.qty(best.fillKg) })}</Button> : <Button variant="primary" onClick={() => setHaul(best)}><Icon name="truck" size={16} />{t("decide.sell.ship", { city: cat.city(best.cityId) })}</Button>}</div>
              </section>
            ) : null}
            {side === "sell" && d.avgCostPerKg ? <span className="muted small">{t("decide.sell.profitHint", { c: i.price(d.avgCostPerKg) })}</span> : null}
            {d.rows.length ? (
              <Table cols={cols} rows={d.rows} rowKey={(r) => r.orderId} rowClass={(r) => `${r.orderId === d.bestOrderId ? "best" : ""} ${r.isSystem ? "sys" : ""}`}
                onTap={(r) => { if (side === "buy") setBuy(r); else if (r.notes.includes("NO_STOCK")) return; else if (same(r)) setSell(r); else setHaul(r); }} />
            ) : (
              <EmptyState icon="chart" title={t(side === "buy" ? "offers.noSellers" : "offers.noBuyers", { p: cat.product(productId) })}
                text={t(side === "buy" ? "offers.noSellersText" : "offers.noBuyersText")}
                action={<Button variant="primary" onClick={() => onCreate(side === "buy" ? "buy" : "sell")}>{t(side === "buy" ? "market.newOrder" : "market.newListing")}</Button>} />
            )}
            {d.rows.length ? <div className="row wrap"><Button size="sm" onClick={() => onCreate(side === "buy" ? "buy" : "sell")}>{t(side === "buy" ? "market.newOrder" : "market.newListing")}</Button></div> : null}
            <BuySheet row={buy} data={d} onClose={() => setBuy(null)} reload={res.reload} />
            <SellSheet row={sell} data={d} onClose={() => setSell(null)} reload={res.reload} onSold={onSold} />
            <HaulSheet row={haul} data={d} onClose={() => setHaul(null)} />
          </div>
        );
      }}
    </Async>
  );
}

function RowSummary({ r, d }: { r: OfferRowDto; d: OffersDto }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  return (
    <>
      <div className="row between"><b style={{ fontSize: "var(--fs-lg)" }}>{cat.product(d.productId)}</b><span className="muted">{t("common.quality")} {r.quality}</span></div>
      <KV k={d.side === "buy" ? t("offers.seller") : t("offers.buyer")} v={<span className="row" style={{ justifyContent: "flex-end" }}>{r.companyName}{r.isSystem ? <SystemBadge /> : null}</span>} />
      <KV k={t("offers.city")} v={`${cat.city(r.cityId)}${r.km ? ` · ${r.km} km` : ""}`} />
      <KV k={t("market.qty")} v={<span>{i.qty(r.fillKg)}{r.fillKg < d.qtyKg ? <span className="muted"> ({t("offers.notes.partial")})</span> : null}</span>} />
      <KV k={t("market.price")} v={<span>{i.price(r.pricePerKg)}</span>} />
    </>
  );
}

function BuySheet({ row, data, onClose, reload }: { row: OfferRowDto | null; data: OffersDto; onClose: () => void; reload: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const same = !!row && row.notes.includes("SAME_CITY");
  const go = async () => {
    if (!row) return;
    const r = await run(() => api.post(`/market/listings/${row.orderId}/buy`, { qtyKg: row.fillKg, expectedPricePerKg: Number(row.pricePerKg), ...(same ? {} : { deliverToCityId: data.cityId }) }), { ok: same ? "offers.boughtHere" : "offers.boughtDeliver" });
    if (r) onClose(); else reload();
  };
  const dest = cat.city(data.cityId);
  return (
    <Sheet open={!!row} onClose={onClose} closeLabel={t("common.close")} title={t("market.buy")}
      footer={<Button variant="primary" size="lg" loading={busy} onClick={() => void go()}>{same ? t("offers.buyHere") : t("offers.buyDeliver", { city: dest })}</Button>}>
      {row ? (
        <div className="col tight">
          <RowSummary r={row} d={data} />
          <KV k={t("offers.goods")} v={i.money(row.goods)} />
          {!same ? <KV k={`${t("offers.freight")}${row.loads > 1 ? ` (${t("offers.notes.split", { n: row.loads })})` : ""}`} v={i.money(row.freight)} /> : null}
          <hr className="sep" />
          <KV k={<b>{t("offers.total")}</b>} v={<b className="num" style={{ fontSize: "var(--fs-lg)" }}>{i.money(row.total)}</b>} />
          <KV k={t("offers.deliveredPerT")} v={i.price(row.perKg)} />
          <KV k={same ? t("offers.available") : t("offers.arrives")} v={same ? t("offers.now") : <span>{i.dur(row.etaMinutes)} · {i.date(row.arrivesAt)}</span>} />
          {!same ? <span className="muted small">{t("offers.freightNote")}</span> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

export type SoldInfo = { saleId: string; productId: string; qtyKg: number; gross: string; profit: string };

/** Satış sonrası: tahsilat ve kâr, satışın muhasebe ayrıntısına tek dokunuş. Panel düzeyinde durur (stok bitince teklif listesi kaybolsa da kalır). */
function SoldSheet({ sold, onClose }: { sold: SoldInfo | null; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  return (
    <Sheet open={!!sold} onClose={onClose} closeLabel={t("common.close")} title={t("flow.soldTitle")}
      footer={sold ? <><Button onClick={onClose}>{t("flow.keepSelling")}</Button><Button variant="primary" size="lg" onClick={() => { onClose(); open("finance", { params: { view: "sales", sale: sold.saleId } }); }}><Icon name="wallet" size={16} />{t("flow.openAccounting")}</Button></> : undefined}>
      {sold ? (
        <div className="col tight" role="status">
          <p style={{ margin: 0 }}>{t("flow.soldText", { q: i.qty(sold.qtyKg), product: cat.product(sold.productId), g: i.money(sold.gross), p: i.signed(sold.profit) })}</p>
          <KV k={t("accounting.remaining")} v={<Trend value={sold.profit} text={i.signed(sold.profit)} />} />
        </div>
      ) : null}
    </Sheet>
  );
}

function SellSheet({ row, data, onClose, reload, onSold }: { row: OfferRowDto | null; data: OffersDto; onClose: () => void; reload: () => void; onSold: (s: SoldInfo) => void }) {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const go = async () => {
    if (!row) return;
    const r = await run(() => api.post<BuyResultDto>(`/market/orders/${row.orderId}/sell`, { qtyKg: row.fillKg, quality: row.quality, expectedPricePerKg: Number(row.pricePerKg) }));
    if (r) { onClose(); onSold({ saleId: r.saleId, productId: data.productId, qtyKg: row.fillKg, gross: r.gross, profit: (BigInt(r.gross) - BigInt(r.fee) - BigInt(r.cogs)).toString() }); }
    else reload();
  };
  return (
    <Sheet open={!!row} onClose={onClose} closeLabel={t("common.close")} title={t("market.sell")}
      footer={<Button variant="primary" size="lg" loading={busy} onClick={() => void go()}>{t("offers.sellNow", { q: row ? i.qty(row.fillKg) : "" })}</Button>}>
      {row ? (
        <div className="col tight">
          <RowSummary r={row} d={data} />
          <KV k={t("offers.goods")} v={i.money(row.goods)} />
          <KV k={t("offers.fee")} v={`− ${i.money(row.fee)}`} />
          <hr className="sep" />
          <KV k={<b>{t("offers.youReceive")}</b>} v={<b className="num" style={{ fontSize: "var(--fs-lg)" }}>{i.money(row.total)}</b>} />
          {row.profit !== null ? <KV k={t("offers.profit")} v={<Trend value={row.profit} text={i.signed(row.profit)} />} /> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** Uzak alıcı: stoğu sistem taşımacısıyla alıcının şehrine taşıt (sunucu tarifeli iş açar); kendi boş aracın varsa onunla gönder. */
function HaulSheet({ row, data, onClose }: { row: OfferRowDto | null; data: OffersDto; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const { run, busy } = useAction();
  const fleet = useList<VehicleDto>(row ? "/fleet" : null, undefined, ["shipments", "company"]);
  const ownIdle = (fleet.data ?? []).some((v) => v.status === "idle" && v.cityId === data.fromCityId);
  const city = row ? cat.city(row.cityId) : "";
  const go = async () => {
    if (!row || !data.fromCityId) return;
    const r = await run(() => api.post<HaulResultDto>("/market/haul", { originCityId: data.fromCityId, destCityId: row.cityId, productId: data.productId, quality: row.quality, qtyKg: row.fillKg }), { ok: "decide.sell.shipped" });
    if (r) onClose();
  };
  const own = () => {
    if (!row || !data.fromCityId) return;
    setShipIntent({ fromCityId: data.fromCityId, destCityId: row.cityId, productId: data.productId, quality: row.quality, qtyKg: row.fillKg });
    onClose();
    open("logistics");
  };
  return (
    <Sheet open={!!row} onClose={onClose} closeLabel={t("common.close")} title={t("decide.sell.shipTitle", { city })}
      footer={<>{ownIdle ? <Button onClick={own}>{t("decide.sell.shipOwn")}</Button> : null}<Button variant="primary" size="lg" loading={busy} onClick={() => void go()}>{t("decide.sell.shipBtn")}</Button></>}>
      {row ? (
        <div className="col tight">
          <RowSummary r={row} d={data} />
          <KV k={t("offers.goods")} v={i.money(row.goods)} />
          <KV k={t("offers.fee")} v={`− ${i.money(row.fee)}`} />
          <KV k={`${t("offers.freight")}${row.loads > 1 ? ` (${t("offers.notes.split", { n: row.loads })})` : ""}`} v={`− ${i.money(row.freight)}`} />
          <hr className="sep" />
          <KV k={<b>{t("decide.sell.shipNet")}</b>} v={<b className="num" style={{ fontSize: "var(--fs-lg)" }}>{i.money(row.total)}</b>} />
          {row.profit !== null ? <KV k={t("offers.profit")} v={<Trend value={row.profit} text={i.signed(row.profit)} />} /> : null}
          <p className="small muted2" style={{ margin: "8px 0 0" }}>{t("decide.sell.shipStep1", { city, a: i.money(row.freight), t: i.dur(row.etaMinutes) })}</p>
          <p className="small muted2" style={{ margin: 0 }}>{t("decide.sell.shipStep2", { city })}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
