"use client";
import { useEffect, useMemo, useState } from "react";
import type { HoldingDto, ListingDto, MarketDto, MarketOverviewDto, PriceHistoryDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, EmptyState, KV, Notice, PriceInput, QtyInput, SelectField, Seg, Sheet, SystemBadge, Table, type Col } from "@/ui";
import { usePlay } from "../play/context";

export type View = { productId: string; cityId: string } | null;

export function Board() {
  const [view, setView] = useState<View>(null);
  const [createSide, setCreateSide] = useState<"sell" | "buy" | null>(null);
  if (view) return <ProductPage view={view} setView={setView} createSide={createSide} setCreateSide={setCreateSide} />;
  return <Overview onPick={(productId, cityId) => setView({ productId, cityId })} />;
}

function Overview({ onPick }: { onPick: (productId: string, cityId: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const w = cat.world;
  const res = useData<MarketOverviewDto>("/market/overview", undefined, ["market"]);
  const [by, setBy] = useState<"city" | "product">("city");
  const [city, setCity] = useState(w.cities[0]!.id);
  const [product, setProduct] = useState(w.products[0]!.id);
  type Row = MarketOverviewDto["rows"][number];
  const cols: Col<Row>[] = [
    { key: "k", head: by === "city" ? t("inventory.product") : t("inventory.city"), cell: (r) => <b>{by === "city" ? cat.product(r.productId) : cat.city(r.cityId)}</b> },
    { key: "r", head: t("market.ref"), right: true, cell: (r) => <span className="num">{i.price(r.refPricePerKg)}</span> },
    { key: "a", head: t("market.bestAsk"), right: true, cell: (r) => r.bestAsk ? <span className="num">{i.price(r.bestAsk)} <span className="muted xs">({i.qty(r.askKg)})</span></span> : <span className="muted">—</span> },
    { key: "b", head: t("market.bestBid"), right: true, cell: (r) => r.bestBid ? <span className="num">{i.price(r.bestBid)} <span className="muted xs">({i.qty(r.bidKg)})</span></span> : <span className="muted">—</span> },
    { key: "s", head: t("market.systemDemand"), right: true, cell: (r) => <span className="num">{r.systemBidRemainingKg ? i.qty(r.systemBidRemainingKg) : "—"}</span> },
    { key: "v", head: t("market.volume24h"), right: true, cell: (r) => <span className="num">{i.qty(r.volume24hKg)}</span> },
  ];
  return (
    <Async res={res}>
      {(d) => {
        const rows = d.rows.filter((r) => (by === "city" ? r.cityId === city : r.productId === product));
        return (
          <div className="col">
            <Seg label={t("market.groupBy")} value={by} onChange={setBy} items={[{ id: "city", label: t("market.byCity") }, { id: "product", label: t("market.byProduct") }]} />
            <div className="pill-scroll" role="group">
              {by === "city" ? w.cities.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={city === c.id} onClick={() => setCity(c.id)}>{i.name(c.name)}</button>)
                : w.products.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={product === p.id} onClick={() => setProduct(p.id)}><span className="dot" style={{ background: p.color }} aria-hidden="true" />{i.name(p.name)}</button>)}
            </div>
            {rows.length ? <Table cols={cols} rows={rows} rowKey={(r) => `${r.productId}-${r.cityId}`} onRow={(r) => onPick(r.productId, r.cityId)} rowLabel={(r) => `${cat.product(r.productId)} ${cat.city(r.cityId)}`} /> : <EmptyState icon="chart" title={t("market.noRows")} />}
          </div>
        );
      }}
    </Async>
  );
}

function Spark({ productId, cityId }: { productId: string; cityId: string }) {
  const { t } = useT();
  const h = useData<PriceHistoryDto>("/market/history", { productId, cityId }, ["market"]);
  const pts = h.data?.points ?? [];
  if (pts.length < 2) return null;
  const ys = pts.map((p) => Number(p.refPricePerKg));
  const min = Math.min(...ys), max = Math.max(...ys);
  const path = ys.map((y, n) => `${(n / (ys.length - 1)) * 100},${max === min ? 20 : 38 - ((y - min) / (max - min)) * 36}`).join(" ");
  const up = ys[ys.length - 1]! >= ys[0]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="56" role="img" aria-label={t("market.historyAlt")}>
        <polyline points={path} fill="none" stroke={up ? "var(--good)" : "var(--bad)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="xs muted">{t("market.history")} {up ? "▲" : "▼"}</figcaption>
    </figure>
  );
}

function ProductPage({ view, setView, createSide, setCreateSide }: { view: NonNullable<View>; setView: (v: View) => void; createSide: "sell" | "buy" | null; setCreateSide: (s: "sell" | "buy" | null) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run } = useAction();
  const { open } = usePlay();
  const res = useData<MarketDto>("/market", { cityId: view.cityId, productId: view.productId }, ["market", "inventory"]);
  const overview = useData<MarketOverviewDto>("/market/overview", undefined, ["market"]);
  const [buying, setBuying] = useState<ListingDto | null>(null);
  const [selling, setSelling] = useState<ListingDto | null>(null);
  const cancel = (l: ListingDto) => run(() => api.post(l.side === "sell" ? `/market/listings/${l.id}/cancel` : `/market/orders/${l.id}/cancel`), { ok: "market.cancelled" });
  const lcols = (side: "sell" | "buy"): Col<ListingDto>[] => [
    { key: "c", head: t("market.company"), cell: (l) => <span className="row wrap">{l.companyName} {l.isSystem ? <SystemBadge /> : null}{l.mine ? <Badge tone="forge">{t("market.mine")}</Badge> : null}</span> },
    { key: "q", head: side === "sell" ? t("common.quality") : t("market.minQuality"), cell: (l) => `★${l.quality}` },
    { key: "n", head: t("market.remaining"), right: true, cell: (l) => <span className="num">{i.qty(l.remainingKg)}</span> },
    { key: "p", head: t("market.price"), right: true, cell: (l) => <b className="num">{i.price(l.pricePerKg)}</b> },
    { key: "a", head: "", bare: true, act: true, cell: (l) => l.mine ? <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); void cancel(l); }}>{t("common.cancel")}</Button> : side === "sell" ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setBuying(l); }}>{t("market.buy")}</Button> : <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setSelling(l); }}>{t("market.sell")}</Button> },
  ];
  return (
    <div className="col">
      <Button variant="ghost" size="sm" onClick={() => setView(null)}>← {t("common.back")}</Button>
      <div className="row between wrap"><h3>{cat.product(view.productId)}</h3>
        <div className="pill-scroll">{cat.world.cities.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={view.cityId === c.id} onClick={() => setView({ ...view, cityId: c.id })}>{i.name(c.name)}</button>)}</div></div>
      <Async res={res}>
        {(m) => (
          <div className="col">
            <Card tight><div className="row between"><span className="muted2">{t("market.ref")}</span><b className="num">{i.price(m.refPricePerKg)}</b></div><Spark productId={view.productId} cityId={view.cityId} /></Card>
            <div className="row wrap"><Button variant="primary" onClick={() => setCreateSide("sell")}>{t("market.newListing")}</Button><Button onClick={() => setCreateSide("buy")}>{t("market.newOrder")}</Button></div>

            <h4>{t("market.asks")}</h4>
            {m.listings.length ? <Table cols={lcols("sell")} rows={m.listings} rowKey={(l) => l.id} /> : <EmptyState icon="chart" title={t("market.noAsks")} text={t("market.noAsksText")} action={<Button onClick={() => setCreateSide("buy")}>{t("market.newOrder")}</Button>} />}
            <h4>{t("market.bids")}</h4>
            {m.orders.length ? <Table cols={lcols("buy")} rows={m.orders} rowKey={(l) => l.id} /> : <EmptyState icon="chart" title={t("market.noBids")} text={t("market.noBidsText")} action={<Button onClick={() => setCreateSide("sell")}>{t("market.newListing")}</Button>} />}

            <h4>{t("market.whoBuys")}</h4>
            <Async res={overview}>
              {(o) => {
                const rows = o.rows.filter((r) => r.productId === view.productId && (r.bestBid || r.systemBidRemainingKg > 0)).map((r) => ({ r, km: r.cityId === view.cityId ? 0 : cat.km(view.cityId, r.cityId) })).sort((a, b) => (a.km ?? 9999) - (b.km ?? 9999));
                if (!rows.length) return <p className="muted small">{t("market.noBuyers")}</p>;
                return <div className="col tight">{rows.map(({ r, km }) => (
                  <div key={r.cityId} className="li click" role="button" tabIndex={0} onClick={() => setView({ ...view, cityId: r.cityId })} onKeyDown={(e) => { if (e.key === "Enter") setView({ ...view, cityId: r.cityId }); }}>
                    <div className="grow col tight"><b>{cat.city(r.cityId)}</b><span className="xs muted">{km === 0 ? t("market.sameCity") : `${km ?? "?"} km`} · {t("market.systemDemand")}: {r.systemBidRemainingKg ? i.qty(r.systemBidRemainingKg) : "—"}</span></div>
                    <div className="col tight" style={{ textAlign: "right" }}><b className="num">{r.bestBid ? i.price(r.bestBid) : i.price(r.refPricePerKg)}</b><span className="xs muted">{r.bestBid ? t("market.bestBid") : t("market.ref")}</span></div>
                  </div>
                ))}</div>;
              }}
            </Async>
            <Button onClick={() => open("logistics")}>{t("market.haulToBuyer")}</Button>

            <h4>{t("market.recent")}</h4>
            {m.recentTrades.length ? m.recentTrades.map((x, n) => (
              <div key={n} className="li"><span className="xs muted grow">{i.date(x.at)}</span><span className="small">★{x.quality} · {i.qty(x.qtyKg)}</span><b className="num small">{i.price(x.pricePerKg)}</b>{x.system ? <SystemBadge /> : null}</div>
            )) : <p className="muted small">{t("common.none")}</p>}
          </div>
        )}
      </Async>
      <TradeSheet kind="buy" listing={buying} onClose={() => setBuying(null)} view={view} />
      <TradeSheet kind="sell" listing={selling} onClose={() => setSelling(null)} view={view} />
      <CreateSheet side={createSide} onClose={() => setCreateSide(null)} view={view} refPrice={res.data?.refPricePerKg ?? null} />
    </div>
  );
}

export function useStock(cityId: string, productId: string) {
  const inv = useData<HoldingDto[]>("/inventory", undefined, ["inventory"]);
  return useMemo(() => (inv.data ?? []).filter((h) => h.cityId === cityId && h.productId === productId && h.availableKg > 0).sort((a, b) => b.quality - a.quality), [inv.data, cityId, productId]);
}

/** Bir ilandan alım / bir alım emrine satış */
function TradeSheet({ kind, listing, onClose, view }: { kind: "buy" | "sell"; listing: ListingDto | null; onClose: () => void; view: NonNullable<View> }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const stock = useStock(view.cityId, view.productId);
  const usable = listing ? stock.filter((h) => h.quality >= listing.quality) : [];
  const [qty, setQty] = useState<number | null>(null);
  const [q, setQ] = useState<number | null>(null);
  useEffect(() => { setQty(null); setQ(null); }, [listing?.id]);
  const quality = q ?? usable[0]?.quality ?? null;
  const max = kind === "sell" ? Math.min(listing?.remainingKg ?? 0, usable.find((h) => h.quality === quality)?.availableKg ?? 0) : listing?.remainingKg ?? 0;
  const ok = !!listing && !!qty && qty <= max && (kind === "buy" || quality !== null);
  const go = async () => {
    if (!listing || !qty) return;
    const body = kind === "buy" ? { qtyKg: qty, expectedPricePerKg: Number(listing.pricePerKg) } : { qtyKg: qty, quality, expectedPricePerKg: Number(listing.pricePerKg) };
    const r = await run(() => api.post(kind === "buy" ? `/market/listings/${listing.id}/buy` : `/market/orders/${listing.id}/sell`, body), { ok: kind === "buy" ? "market.bought" : "market.sold" });
    if (r) onClose();
  };
  return (
    <Sheet open={!!listing} onClose={onClose} closeLabel={t("common.close")} title={`${kind === "buy" ? t("market.buy") : t("market.sell")} · ${cat.product(view.productId)}`}
      footer={<Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={() => void go()}>{kind === "buy" ? t("market.buy") : t("market.sell")}</Button>}>
      {listing ? (
        <div className="col">
          <KV k={t("market.company")} v={<>{listing.companyName} {listing.isSystem ? <SystemBadge /> : null}</>} />
          <KV k={t("market.price")} v={<b>{i.price(listing.pricePerKg)}</b>} />
          <KV k={t("market.remaining")} v={i.qty(listing.remainingKg)} />
          {kind === "sell" ? (usable.length ? (
            <SelectField label={t("common.quality")} value={String(quality)} onChange={(v) => setQ(Number(v))} options={usable.map((h) => ({ id: String(h.quality), label: `★${h.quality} — ${i.qty(h.availableKg)}` }))} />
          ) : <Notice tone="warn">{t("market.noStockHere")}</Notice>) : null}
          <QtyInput label={t("market.qty")} value={qty} onChange={setQty} max={max} hint={t("market.maxQty", { q: i.qty(max) })} />
          <span className="muted small">{t("market.feeNote", { pct: i.pct(cat.world.marketFeeBp) })}</span>
        </div>
      ) : null}
    </Sheet>
  );
}

export function CreateSheet({ side, onClose, view, refPrice }: { side: "sell" | "buy" | null; onClose: () => void; view: NonNullable<View>; refPrice: string | null }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const stock = useStock(view.cityId, view.productId);
  const [quality, setQuality] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => { if (side) { setQty(null); setPrice(refPrice ? Number(refPrice) : null); } }, [side, refPrice]);
  const q = quality ?? (side === "sell" ? stock[0]?.quality : 2) ?? 2;
  const avail = side === "sell" ? stock.find((h) => h.quality === q)?.availableKg ?? 0 : undefined;
  const ok = !!qty && !!price && (side === "buy" || (avail !== undefined && qty <= avail));
  const go = async () => {
    if (!side || !qty || !price) return;
    const r = side === "sell"
      ? await run(() => api.post("/market/listings", { cityId: view.cityId, productId: view.productId, quality: q, qtyKg: qty, pricePerKg: price }), { ok: "market.listed" })
      : await run(() => api.post("/market/orders", { cityId: view.cityId, productId: view.productId, minQuality: q, qtyKg: qty, maxPricePerKg: price }), { ok: "market.ordered" });
    if (r) onClose();
  };
  return (
    <Sheet open={!!side} onClose={onClose} closeLabel={t("common.close")} title={`${side === "sell" ? t("market.newListing") : t("market.newOrder")} · ${cat.product(view.productId)} · ${cat.city(view.cityId)}`}
      footer={<Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={() => void go()}>{side === "sell" ? t("market.newListing") : t("market.newOrder")}</Button>}>
      <div className="col">
        {side === "sell" ? (stock.length ? <SelectField label={t("common.quality")} value={String(q)} onChange={(v) => setQuality(Number(v))} options={stock.map((h) => ({ id: String(h.quality), label: `★${h.quality} — ${i.qty(h.availableKg)}` }))} />
          : <Notice tone="warn">{t("market.noStockHere")}</Notice>)
          : <SelectField label={t("market.minQuality")} value={String(q)} onChange={(v) => setQuality(Number(v))} options={[1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `★${n}` }))} />}
        <QtyInput label={t("market.qty")} value={qty} onChange={setQty} max={avail} />
        <PriceInput label={side === "sell" ? t("market.price") : t("market.maxPrice")} value={price} onChange={setPrice} hint={refPrice ? `${t("market.ref")}: ${i.price(refPrice)}` : undefined} />
      </div>
    </Sheet>
  );
}
