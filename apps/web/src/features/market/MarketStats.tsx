"use client";
import { useState } from "react";
import type { BookQuoteDto, CompareCityDto, LastTradeDto, MarketCompareDto, MarketStatsDto } from "@capitalforge/shared";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, EmptyState, ProgressBar, Seg, SkeletonList, SystemBadge, Table, Tag, type Col } from "@/ui";

const HOURS = [24, 72, 168] as const;

function Source({ s }: { s: "system" | "player" }) {
  const { t } = useT();
  return s === "system" ? <SystemBadge /> : <Tag>{t("mstat.player")}</Tag>;
}

function Num({ label, hint, price, sub, src }: { label: string; hint: string; price: string | null; sub?: string; src?: "system" | "player" }) {
  const i = useT();
  return (
    <div className="ms-num">
      <dt>{label}</dt>
      <dd className="num">{price ? i.price(price) : "—"}</dd>
      <dd className="ms-sub">{price ? <>{sub}{src ? <> <Source s={src} /></> : null}</> : i.t("mstat.none")}</dd>
      <dd className="ms-hint">{hint}</dd>
    </div>
  );
}

const bookSub = (i: ReturnType<typeof useT>, q: BookQuoteDto | null): string | undefined => (q ? `${i.qty(q.remainingKg)} · ${i.t("common.quality")} ${q.quality}` : undefined);

function lastTrade(s: MarketStatsDto): { t: LastTradeDto; src: "system" | "player" } | null {
  const a = s.lastPlayerTrade, b = s.lastSystemTrade;
  if (a && b) return Date.parse(a.at) >= Date.parse(b.at) ? { t: a, src: "player" } : { t: b, src: "system" };
  if (a) return { t: a, src: "player" };
  if (b) return { t: b, src: "system" };
  return null;
}

/** En iyi alış, en iyi satış ve son gerçekleşen fiyat: üç ayrı sayı. Veri azsa fiyatın yanında "Referans fiyat" etiketi (metin). */
export function QuoteView({ s, compact }: { s: MarketStatsDto; compact?: boolean }) {
  const i = useT();
  const { t } = i;
  const lt = lastTrade(s);
  const price = s.lowData ? s.refPricePerKg : s.vwapQ2PerKg ?? s.refPricePerKg;
  return (
    <section className={`ms-quote${compact ? " compact" : ""}`} aria-label={t("mstat.quote")}>
      <dl className="ms-nums">
        <Num label={t("mstat.bid")} hint={t("mstat.bidHint")} price={s.bestBid?.pricePerKg ?? null} sub={bookSub(i, s.bestBid)} src={s.bestBid?.source} />
        <Num label={t("mstat.ask")} hint={t("mstat.askHint")} price={s.bestAsk?.pricePerKg ?? null} sub={bookSub(i, s.bestAsk)} src={s.bestAsk?.source} />
        <Num label={t("mstat.last")} hint={t("mstat.lastHint")} price={lt?.t.pricePerKg ?? null} sub={lt ? `${i.qty(lt.t.qtyKg)} · ${i.date(lt.t.at)}` : undefined} src={lt?.src} />
      </dl>
      <p className="ms-ref small">
        <span className="muted2">{s.lowData ? t("mstat.refPrice") : t("mstat.vwap")}:</span> <b className="num">{i.price(price)}</b>
        {s.lowData ? <> <Tag tone="warn" icon="alert">{t("market.ref")}</Tag></> : null}
      </p>
      {s.lowData ? <p className="xs muted2 ms-low">{t("mstat.lowData", { n: s.distinctPairs, min: s.minDistinctPairs })}</p> : null}
    </section>
  );
}

/** Dönem hacmi, oyuncular arası pay, sistem işlemleri ayrı satırda. */
export function DepthView({ s, hours, setHours }: { s: MarketStatsDto; hours: number; setHours: (h: number) => void }) {
  const i = useT();
  const { t } = i;
  const total = s.playerVolumeKg + s.systemVolumeKg;
  return (
    <section className="ms-depth" aria-label={t("mstat.depth")}>
      <div className="row between wrap">
        <h4>{t("mstat.depth")}</h4>
        <Seg label={t("mstat.period")} value={String(hours)} onChange={(v) => setHours(Number(v))} items={HOURS.map((h) => ({ id: String(h), label: h === 24 ? t("mstat.h24") : h === 72 ? t("mstat.d3") : t("mstat.d7") }))} />
      </div>
      {total === 0 ? <p className="small muted2">{t("mstat.noTrades")}</p> : (
        <dl className="ms-rows">
          <div><dt>{t("mstat.volume")}</dt><dd className="num"><b>{i.qty(total)}</b> <span className="muted2 xs">· {t("mstat.tradeCount", { n: s.tradeCount })}</span></dd></div>
          <div><dt>{t("mstat.p2p")}</dt><dd className="num"><b>{i.pct(s.p2pShareBp)}</b></dd></div>
          <div className="ms-bar"><ProgressBar value={s.p2pShareBp / 100} steel label={t("mstat.p2p")} /></div>
          <div><dt>{t("mstat.playerVol")}</dt><dd className="num">{i.qty(s.playerVolumeKg)}</dd></div>
          <div className="ms-sysrow"><dt className="row">{t("mstat.systemVol")} <SystemBadge /></dt><dd className="num">{i.qty(s.systemVolumeKg)}</dd></div>
        </dl>
      )}
      {s.vwapByQuality.length ? (
        <p className="xs muted2 ms-q">{s.vwapByQuality.map((q) => `${t("common.quality")} ${q.quality}: ${i.price(q.vwapPerKg)} (${i.qty(q.volumeKg)})`).join(" · ")}</p>
      ) : null}
    </section>
  );
}

export function useMarketStats(productId: string, cityId: string, hours: number) {
  return useData<MarketStatsDto>("/market/stats", { productId, cityId, hours }, ["market"]);
}

/** Yalnızca fiyat sayıları (ürün sayfasında kullanılır). */
export function MarketQuote({ productId, cityId, compact }: { productId: string; cityId: string; compact?: boolean }) {
  const res = useMarketStats(productId, cityId, 24);
  return <Async res={res}>{(s) => (s.productId === productId && s.cityId === cityId ? <QuoteView s={s} compact={compact} /> : <SkeletonList n={1} h={96} />)}</Async>;
}

/** Pazar sayfasındaki ürün istatistiği: fiyatlar + derinlik. */
export function MarketStatsBlock({ productId, cityId }: { productId: string; cityId: string }) {
  const [hours, setHours] = useState<number>(24);
  const res = useMarketStats(productId, cityId, hours);
  return (
    <Async res={res}>
      {(s) => (s.productId !== productId || s.cityId !== cityId ? <SkeletonList n={2} h={96} /> : (
        <div className="ms-block"><QuoteView s={s} /><DepthView s={s} hours={hours} setHours={setHours} /></div>
      ))}
    </Async>
  );
}

const big = (v: string | null): bigint => (v === null ? -(10n ** 30n) : BigInt(v));

/** Şehir şehir net getiri: navlun ve komisyon düşülmüş; en iyi şehir etiket + vurguyla. */
export function RouteNetTable({ productId, qtyKg, quality, fromCityId }: { productId: string; qtyKg: number; quality?: number; fromCityId: string | null }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useData<MarketCompareDto>(qtyKg > 0 ? "/market/compare" : null, { productId, qtyKg, quality, fromCityId }, ["market", "inventory"]);
  return (
    <section className="ms-route" aria-label={t("mstat.route")}>
      <h4>{t("mstat.route")}</h4>
      <p className="small muted2">{t("mstat.routeHint", { pct: i.pct(res.data?.marketFeeBp ?? cat.world.marketFeeBp) })}</p>
      {qtyKg <= 0 ? <p className="small muted2">{t("offers.enterQty")}</p> : (
        <Async res={res}>
          {(d) => {
            if (d.productId !== productId || d.qtyKg !== qtyKg) return <SkeletonList n={2} h={64} />;
            const rows = [...d.rows].sort((a, b) => (big(b.net) > big(a.net) ? 1 : big(b.net) < big(a.net) ? -1 : 0));
            const cols: Col<CompareCityDto>[] = [
              { key: "c", head: t("offers.city"), lead: true, cell: (r) => (
                <span className="col tight" style={{ gap: 2 }}>
                  <span className="row wrap"><b>{cat.city(r.cityId)}</b>{r.cityId === d.bestCityId ? <Tag tone="forge" icon="star">{t("offers.best")}</Tag> : null}{r.cityId === d.fromCityId ? <Tag icon="city">{t("offers.notes.sameCity")}</Tag> : null}</span>
                  <span className="xs muted2">{r.km !== null ? `${r.km} km · ${i.dur(r.etaMinutes ?? 0)}` : ""}{r.bestBid ? `${r.km !== null ? " · " : ""}${t("mstat.bid")}: ${i.price(r.bestBid.pricePerKg)}` : ""}{r.lowData ? <> <Tag tone="warn">{t("market.ref")}</Tag></> : null}</span>
                </span>
              ) },
              { key: "f", head: t("offers.freight"), right: true, nowrap: true, cell: (r) => <span className="num">{r.freight !== null ? i.money(r.freight) : "—"}</span> },
              { key: "m", head: t("offers.fee"), right: true, nowrap: true, cell: (r) => <span className="num">{r.fee !== null ? i.money(r.fee) : "—"}</span> },
              { key: "p", head: t("offers.netPerT"), right: true, nowrap: true, cell: (r) => <b className="num">{r.netPerKg !== null ? i.price(r.netPerKg) : t("mstat.noBuyer")}</b> },
              { key: "n", head: t("mstat.netTotal"), right: true, nowrap: true, cell: (r) => <span className="col tight" style={{ alignItems: "inherit", gap: 0 }}><b className="num">{r.net !== null ? i.money(r.net) : "—"}</b>{r.bestBid && r.fillKg < d.qtyKg ? <span className="xs warn">{t("mstat.fills", { a: i.qty(r.fillKg), b: i.qty(d.qtyKg) })}</span> : null}</span> },
            ];
            if (!rows.length) return <EmptyState icon="chart" title={t("mstat.noBuyer")} />;
            return <Table cols={cols} rows={rows} rowKey={(r) => r.cityId} rowClass={(r) => (r.cityId === d.bestCityId ? "best" : "")} />;
          }}
        </Async>
      )}
    </section>
  );
}
