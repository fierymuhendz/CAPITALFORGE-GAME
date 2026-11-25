"use client";
import { useEffect, useMemo, useState } from "react";
import type { HoldingDto, OfferNote, OfferRowDto, OffersDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useDebounced } from "@/lib/debounce";
import { setShipIntent, takeMarketIntent } from "@/lib/intent";
import { useT, type I18n } from "@/lib/i18n";
import { Async, Button, EmptyState, KV, QtyInput, SelectField, Sheet, SystemBadge, Table, Tabs, Tag, Trend, type Col } from "@/ui";
import { usePlay } from "../play/context";
import { Board, CreateSheet, type View } from "./MarketBoard";

type Tab = "buy" | "sell" | "board";

export function MarketPanel() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { me } = useApp();
  const { open } = usePlay();
  const [tab, setTab] = useState<Tab>("buy");
  const [productId, setProductId] = useState(cat.world.products[0]!.id);
  const [toCity, setToCity] = useState(me?.company?.homeCityId ?? cat.world.cities[0]!.id);
  const [fromCity, setFromCity] = useState<string | null>(null);
  const [qtyBuy, setQtyBuy] = useState<number | null>(1000);
  const [qtySell, setQtySell] = useState<number | null>(null);
  const [create, setCreate] = useState<"sell" | "buy" | null>(null);
  useEffect(() => {
    const it = takeMarketIntent();
    if (it) { setProductId(it.productId); if (it.side === "sell") { setTab("sell"); setFromCity(it.cityId); } else setToCity(it.cityId); }
  }, []);
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
  const stockKg = stockCities.find(([c]) => c === from)?.[1] ?? 0;
  const pick = (id: string) => { setProductId(id); setQtySell(null); setFromCity(null); };
  const chips = tab === "sell" ? sellProducts : cat.world.products;
  const createView: View = { productId: prodId, cityId: tab === "sell" ? from ?? toCity : toCity };

  return (
    <div className="col">
      <Tabs label={t("panels.market")} value={tab} onChange={(v) => setTab(v as Tab)} items={[{ id: "buy", label: t("offers.tabBuy") }, { id: "sell", label: t("offers.tabSell") }, { id: "board", label: t("offers.tabBoard") }]} />
      {tab === "board" ? <Board /> : (
        <>
          {chips.length ? (
            <div className="pill-scroll" role="group" aria-label={t("inventory.product")}>
              {chips.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={prodId === p.id} onClick={() => pick(p.id)}>
                  <span className="dot" style={{ background: p.color }} aria-hidden="true" />{cat.product(p.id)}{tab === "sell" ? <span className="muted xs num">{i.qty(held.get(p.id) ?? 0)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "sell" && !chips.length ? (
            <EmptyState icon="box" title={t("offers.noStockTitle")} text={t("offers.noStockText")} action={<div className="row wrap"><Button variant="primary" onClick={() => open("facilities")}>{t("inventory.goProduce")}</Button><Button onClick={() => setTab("buy")}>{t("offers.tabBuy")}</Button></div>} />
          ) : (
            <>
              <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))" }}>
                {tab === "buy" ? (
                  <SelectField label={t("offers.deliverTo")} value={toCity} onChange={setToCity} options={cat.world.cities.map((c) => ({ id: c.id, label: cat.city(c.id) }))} />
                ) : (
                  <SelectField label={t("offers.stockIn")} value={from ?? ""} onChange={(v) => { setFromCity(v); setQtySell(null); }} options={stockCities.map(([c, kg]) => ({ id: c, label: `${cat.city(c)} — ${i.qty(kg)}` }))} />
                )}
                {tab === "buy"
                  ? <QtyInput label={t("market.qty")} value={qtyBuy} onChange={setQtyBuy} />
                  : <QtyInput label={t("market.qty")} value={qtySell ?? stockKg} onChange={setQtySell} max={stockKg} />}
              </div>
              <Offers side={tab} productId={prodId} cityId={tab === "buy" ? toCity : from} fromCityId={tab === "sell" ? from : null} qtyKg={tab === "buy" ? qtyBuy : qtySell ?? stockKg} onCreate={setCreate} />
            </>
          )}
        </>
      )}
      <CreateSheet side={create} onClose={() => setCreate(null)} view={createView} refPrice={null} />
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

function Offers({ side, productId, cityId, fromCityId, qtyKg, onCreate }: { side: "buy" | "sell"; productId: string; cityId: string | null; fromCityId: string | null; qtyKg: number | null; onCreate: (s: "sell" | "buy") => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const q = useDebounced(qtyKg, 350);
  const valid = !!cityId && !!q && q > 0 && q <= 10_000_000;
  const res = useData<OffersDto>(valid ? "/market/offers" : null, { side, productId, cityId, qtyKg: q, fromCityId }, ["market", "inventory"]);
  const [buy, setBuy] = useState<OfferRowDto | null>(null);
  const [sell, setSell] = useState<OfferRowDto | null>(null);
  const ship = (d: OffersDto, r: OfferRowDto) => {
    if (!d.fromCityId) return;
    setShipIntent({ fromCityId: d.fromCityId, destCityId: r.cityId, productId, quality: r.quality, qtyKg: r.fillKg });
    open("logistics");
  };
  if (!valid) return <p className="muted small" role="status">{t("offers.enterQty")}</p>;
  return (
    <Async res={res}>
      {(d) => {
        const same = (r: OfferRowDto) => r.notes.includes("SAME_CITY");
        const cols: Col<OfferRowDto>[] = [
          { key: "w", head: side === "buy" ? t("offers.seller") : t("offers.buyer"), lead: true, cell: (r) => {
            const tags = [r.orderId === d.bestOrderId ? <Tag key="b" tone="forge" icon="star">{t("offers.best")}</Tag> : null, r.orderId === d.fastestOrderId ? <Tag key="f" tone="good" icon="bolt">{t("offers.fastest")}</Tag> : null, ...r.notes.filter((n) => n !== "SAME_CITY" || side === "sell").map((n) => noteTag(i, n, r))].filter(Boolean);
            return (
              <span className="col tight" style={{ gap: 4, minWidth: 0 }}>
                <span className="row" style={{ minWidth: 0 }}><b className="nm" title={r.companyName}>{r.companyName}</b>{r.isSystem ? <SystemBadge /> : null}<span className="muted xs">★{r.quality}</span></span>
                {tags.length ? <span className="tags">{tags}</span> : null}
              </span>
            );
          } },
          { key: "c", head: t("offers.city"), nowrap: true, cell: (r) => <span>{cat.city(r.cityId)}{same(r) ? "" : ` · ${r.km} km`}</span> },
          { key: "q", head: t("market.qty"), nowrap: true, cell: (r) => <span className="num">{i.qty(r.fillKg)}{r.fillKg < r.availableKg ? <span className="muted xs"> / {i.qty(r.availableKg)}</span> : null}</span> },
          side === "buy"
            ? { key: "p", head: t("offers.deliveredPerT"), right: true, nowrap: true, cell: (r) => <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><b className="num">{i.price(r.perKg)}</b><span className="muted xs num">{i.money(r.total)}</span></span> }
            : { key: "p", head: t("offers.netPerT"), right: true, nowrap: true, cell: (r) => <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><b className="num">{i.price(r.perKg)}</b>{r.profit !== null ? <Trend value={r.profit} text={i.signed(r.profit)} /> : null}</span> },
          { key: "e", head: side === "buy" ? t("offers.arrives") : t("offers.paidIn"), nowrap: true, cell: (r) => <span className="num">{i.dur(r.etaMinutes)}</span> },
          { key: "a", head: "", bare: true, act: true, cell: (r) => side === "buy"
            ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setBuy(r); }}>{t("market.buy")}</Button>
            : r.notes.includes("NO_STOCK") ? <span className="muted xs">—</span>
            : same(r) ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setSell(r); }}>{t("market.sell")}</Button>
            : <Button size="sm" onClick={(e) => { e.stopPropagation(); ship(d, r); }}>{t("offers.shipThere")}</Button> },
        ];
        return (
          <div className="col">
            {side === "sell" && d.avgCostPerKg ? <span className="muted small">{t("offers.avgCost", { p: i.price(d.avgCostPerKg) })}</span> : null}
            {d.rows.length ? (
              <Table cols={cols} rows={d.rows} rowKey={(r) => r.orderId} rowClass={(r) => (r.orderId === d.bestOrderId ? "best" : "")}
                onTap={(r) => { if (side === "buy") setBuy(r); else if (same(r) && !r.notes.includes("NO_STOCK")) setSell(r); }} />
            ) : (
              <EmptyState icon="chart" title={t(side === "buy" ? "offers.noSellers" : "offers.noBuyers", { p: cat.product(productId) })}
                text={t(side === "buy" ? "offers.noSellersText" : "offers.noBuyersText")}
                action={<Button variant="primary" onClick={() => onCreate(side === "buy" ? "buy" : "sell")}>{t(side === "buy" ? "market.newOrder" : "market.newListing")}</Button>} />
            )}
            {d.rows.length ? <div className="row wrap"><Button size="sm" onClick={() => onCreate(side === "buy" ? "buy" : "sell")}>{t(side === "buy" ? "market.newOrder" : "market.newListing")}</Button></div> : null}
            <BuySheet row={buy} data={d} onClose={() => setBuy(null)} reload={res.reload} />
            <SellSheet row={sell} data={d} onClose={() => setSell(null)} reload={res.reload} />
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

function SellSheet({ row, data, onClose, reload }: { row: OfferRowDto | null; data: OffersDto; onClose: () => void; reload: () => void }) {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const go = async () => {
    if (!row) return;
    const r = await run(() => api.post(`/market/orders/${row.orderId}/sell`, { qtyKg: row.fillKg, quality: row.quality, expectedPricePerKg: Number(row.pricePerKg) }), { ok: "market.sold" });
    if (r) onClose(); else reload();
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
