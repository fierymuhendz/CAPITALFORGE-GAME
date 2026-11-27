"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AccountingDto, AccountingPeriod, AccountingTxDto, AccountingTxPageDto, FinanceDto, LedgerLineDto, LoanDto, OutcomeDto, OutcomeFiguresDto, SaleDto, SaleTraceDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, Disclosure, EmptyState, KV, MoneyInput, Notice, Seg, SelectField, Sheet, SkeletonList, Table, Tabs, Trend, type Col } from "@/ui";
import "./accounting.css";
import { usePlay } from "../play/context";

export function FinancePanel() {
  const { t } = useT();
  const sp = useSearchParams();
  const { open } = usePlay();
  const raw = sp.get("view") ?? ((sp.get("tab") ?? sp.get("p")) === "sales" ? "sales" : "accounting");
  const tab = raw === "overview" ? "accounting" : ["accounting", "sales", "results", "loans", "ledger"].includes(raw) ? raw : "accounting";
  const periodRaw = sp.get("period");
  const period: AccountingPeriod = periodRaw === "today" || periodRaw === "30d" ? periodRaw : "7d";
  const saleId = sp.get("sale");
  const go = (p: Record<string, string>) => open("finance", { params: p });
  const setTab = (v: string) => go(v === "accounting" ? { period } : { view: v });
  const openSale = (id: string) => go({ view: tab, ...(tab === "accounting" ? { period } : {}), sale: id });
  const closeSale = () => go({ view: tab, ...(tab === "accounting" ? { period } : {}) });
  return (
    <div className="col acc">
      <Tabs label={t("accounting.title")} value={tab} onChange={setTab} items={[{ id: "accounting", label: t("accounting.tab") }, { id: "sales", label: t("finance.sales") }, { id: "results", label: t("finance.results") }, { id: "loans", label: t("finance.loans") }, { id: "ledger", label: t("finance.ledger") }]} />
      {tab === "accounting" ? <Accounting period={period} onPeriod={(p) => go({ period: p })} onSale={openSale} />
        : tab === "results" ? <Results goLedger={() => setTab("ledger")} onSale={openSale} />
        : tab === "sales" ? <Sales onSale={openSale} />
        : tab === "ledger" ? <Ledger /> : <Loans />}
      <SaleSheet saleId={saleId} onClose={closeSale} />
    </div>
  );
}

const useFinance = () => useData<FinanceDto>("/finance", undefined, ["finance", "company"]);
const TOPICS = ["finance", "company", "market", "contracts", "shipments", "facilities"] as const;

/** Şirket Muhasebesi: kasa (şimdi) + dönem geliri, gideri, net; günlük grafik; nakit akışı; sayfalı işlem geçmişi. Dönem filtresi hepsini birlikte günceller. */
function Accounting({ period, onPeriod, onSale }: { period: AccountingPeriod; onPeriod: (p: AccountingPeriod) => void; onSale: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const { open } = usePlay();
  const res = useData<AccountingDto>("/finance/accounting", { period }, [...TOPICS]);
  const fin = useFinance();
  const periods: Array<{ id: AccountingPeriod; label: string }> = (["today", "7d", "30d"] as const).map((id) => ({ id, label: t(`accounting.periods.${id}`) }));
  return (
    <div className="col acc-page">
      <div className="acc-toolbar">
        <Seg label={t("accounting.period")} items={periods} value={period} onChange={onPeriod} />
        {res.data ? <span className="xs muted">{t("accounting.periodNote", { from: i.date(res.data.from) })}</span> : null}
      </div>
      <Async res={res} skeleton={<SkeletonList n={3} h={90} />}>
        {(a) => {
          const net = BigInt(a.summary.net);
          const nothing = a.summary.revenue === "0" && a.summary.expense === "0";
          return (
            <>
              <dl className="cf-ledger acc-figures" aria-live="polite">
                <div className="acc-now"><dt>{t("accounting.cashNow")}</dt><dd className="num">{i.money(a.cashNow)}</dd></div>
                <div><dt>{t("accounting.revenue")} · {t(`accounting.periods.${a.period}`)}</dt><dd className="num">{i.money(a.summary.revenue)}</dd></div>
                <div><dt>{t("accounting.expense")}</dt><dd className="num">{i.money(a.summary.expense)}</dd></div>
                <div><dt>{net < 0n ? t("accounting.loss") : t("accounting.profit")}</dt><dd><Trend value={a.summary.net} text={i.signed(a.summary.net)} /></dd></div>
              </dl>
              {!a.hasActivity ? (
                <EmptyState icon="chart" title={t("accounting.emptyTitle")} text={t("accounting.emptyText")} action={<Button variant="primary" onClick={() => open("facilities")}>{t("inventory.goProduce")}</Button>} />
              ) : null}
              <div className="acc-grid">
                <section className="card acc-chart-card" aria-labelledby="acc-chart-h">
                  <div className="row between"><h4 id="acc-chart-h">{t("accounting.chartTitle")}</h4>
                    <span className="acc-legend xs"><span><i className="acc-key rev" aria-hidden="true" />{t("accounting.legendRevenue")}</span><span><i className="acc-key exp" aria-hidden="true" />{t("accounting.legendExpense")}</span></span>
                  </div>
                  {nothing ? <p className="muted small">{a.hasActivity ? t("accounting.chartEmpty") : t("accounting.emptyTitle")}</p> : <DailyChart a={a} />}
                  <Breakdown a={a} />
                </section>
                <section className="card acc-cash" aria-labelledby="acc-cash-h">
                  <h4 id="acc-cash-h">{t("accounting.cashflow")}</h4>
                  <KV k={t("accounting.opening")} v={<span className="num">{i.money(a.cashflow.opening)}</span>} />
                  <KV k={t("accounting.operating")} v={<Trend value={a.cashflow.operating} text={i.signed(a.cashflow.operating)} />} />
                  <KV k={t("accounting.investing")} v={<Trend value={a.cashflow.investing} text={i.signed(a.cashflow.investing)} />} />
                  <KV k={t("accounting.financing")} v={<Trend value={a.cashflow.financing} text={i.signed(a.cashflow.financing)} />} />
                  <hr className="sep" />
                  <KV k={<b>{t("accounting.closing")}</b>} v={<b className="num">{i.money(a.cashflow.closing)}</b>} />
                  <span className="xs muted">{t("accounting.cashNote")}</span>
                  {fin.data ? <Disclosure summary={t("finance.balances")}>
                    <KV k={t("finance.netWorth")} v={<b>{i.money(fin.data.netWorth)}</b>} />
                    {Object.entries(fin.data.balances).filter(([, v]) => v !== "0").map(([k, v]) => <KV key={k} k={i.has(`accounts.${k}`) ? t(`accounts.${k}`) : k} v={i.money(v)} />)}
                  </Disclosure> : null}
                </section>
              </div>
              <History key={`${a.period}-${a.from}`} period={a.period} total={a.txCount} onSale={onSale} />
            </>
          );
        }}
      </Async>
    </div>
  );
}

/** Günlük gelir (dolu) ve gider (taralı) çubukları; satır başına erişilebilir özet */
function DailyChart({ a }: { a: AccountingDto }) {
  const i = useT();
  const { t } = i;
  const tag = i.locale === "tr" ? "tr-TR" : "en-US";
  const days = a.daily;
  const max = days.reduce((m, d) => { const r = BigInt(d.revenue), e = BigInt(d.expense); return r > m ? r : e > m ? e : m; }, 0n);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(260, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 150 : 200, L = 58, B = 22, T = 8;
  const slot = (W - L) / days.length;
  const bw = Math.max(3, Math.min(16, slot * 0.32));
  const y = (v: bigint) => { const n = v < 0n ? 0n : v; return max === 0n ? 0 : Number((n * BigInt(H - B - T) * 1000n) / max) / 1000; };
  const label = (d: (typeof days)[number]) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.day}T00:00:00Z`));
  const every = days.length > 10 ? (W < 520 ? 7 : 5) : 1;
  const ticks = [max, max / 2n];
  return (
    <figure className="acc-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t("accounting.chartTitle")}>
        <defs><pattern id="acc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="acc-exp-bg" /><line x1="0" y1="0" x2="0" y2="5" className="acc-exp-line" strokeWidth="2.4" /></pattern></defs>
        {ticks.map((v, n) => { const yy = H - B - y(v); return <g key={n}><line x1={L} x2={W} y1={yy} y2={yy} className="acc-grid-line" /><text x={L - 6} y={yy + 4} textAnchor="end" className="acc-axis">{i.money(v, true)}</text></g>; })}
        <line x1={L} x2={W} y1={H - B} y2={H - B} className="acc-base" />
        {days.map((d, n) => {
          const x = L + n * slot + slot / 2;
          const rh = y(BigInt(d.revenue)), eh = y(BigInt(d.expense));
          const today = n === days.length - 1;
          return (
            <g key={d.day}>
              {today && days.length > 1 ? <rect x={L + n * slot} y={T} width={slot} height={H - B - T} className="acc-today" /> : null}
              <rect x={x - bw - 1} y={H - B - rh} width={bw} height={rh} rx={2} className="acc-rev" />
              <rect x={x + 1} y={H - B - eh} width={bw} height={eh} rx={2} fill="url(#acc-hatch)" className="acc-exp" />
              {n % every === 0 || today ? <text x={today && days.length > 1 ? Math.min(x, W - 2) : x} y={H - 6} textAnchor={today && days.length > 1 ? "end" : "middle"} className="acc-axis">{today ? t("accounting.periods.today") : label(d)}</text> : null}
              <title>{t("accounting.dayTotal", { day: label(d), r: i.money(d.revenue), e: i.money(d.expense), n: i.signed(d.net) })}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <ul>{days.map((d) => <li key={d.day}>{t("accounting.dayTotal", { day: label(d), r: i.money(d.revenue), e: i.money(d.expense), n: i.signed(d.net) })}</li>)}</ul>
      </figcaption>
    </figure>
  );
}

function Breakdown({ a }: { a: AccountingDto }) {
  const i = useT();
  const { t } = i;
  const rev = Object.entries(a.summary.revenueByAccount);
  const exp = Object.entries(a.summary.expenseByAccount);
  if (!rev.length && !exp.length) return null;
  const name = (k: string) => (i.has(`accounts.${k}`) ? t(`accounts.${k}`) : k);
  return (
    <Disclosure summary={t("accounting.breakdown")}>
      <div className="acc-break">
        <div className="col tight"><b className="small">{t("accounting.revenueBy")}</b>{rev.length ? rev.map(([k, v]) => <KV key={k} k={name(k)} v={<span className="num">{i.money(v)}</span>} />) : <span className="muted small">—</span>}</div>
        <div className="col tight"><b className="small">{t("accounting.expenseBy")}</b>{exp.length ? exp.map(([k, v]) => <KV key={k} k={name(k)} v={<span className="num">{i.money(v)}</span>} />) : <span className="muted small">—</span>}</div>
      </div>
    </Disclosure>
  );
}

/** Dönem içi işlem geçmişi; imleçle "daha eski" sayfası. Satış satırı satış muhasebesini açar. */
function History({ period, total, onSale }: { period: AccountingPeriod; total: number; onSale: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const first = useData<AccountingTxPageDto>("/finance/accounting/transactions", { period }, [...TOPICS]);
  const [more, setMore] = useState<AccountingTxDto[]>([]);
  const [next, setNext] = useState<AccountingTxPageDto["next"] | undefined>(undefined);
  const { run, busy } = useAction();
  const [openTx, setOpenTx] = useState<string | null>(null);
  return (
    <section className="card acc-history" aria-labelledby="acc-hist-h">
      <div className="row between"><h4 id="acc-hist-h">{t("accounting.history")}</h4><span className="xs muted">{i.num(total)}</span></div>
      <Async res={first} skeleton={<SkeletonList n={4} h={44} />}>
        {(p) => {
          const items = [...p.items, ...more.filter((m) => !p.items.some((x) => x.id === m.id))];
          const cursor = next === undefined ? p.next : next;
          if (!items.length) return <p className="muted small">{t("accounting.emptyPeriod")}</p>;
          return (
            <>
              <ul className="acc-tx">
                {items.map((x) => {
                  const pl = BigInt(x.revenue) - BigInt(x.expense);
                  const expanded = openTx === x.id;
                  return (
                    <li key={x.id}>
                      <div className="acc-tx-row">
                        <button type="button" className="acc-tx-main" aria-expanded={expanded} onClick={() => setOpenTx(expanded ? null : x.id)}>
                          <b>{i.kind(x.kind)}</b>
                          <small>{x.reversesId ? `${t("accounting.reversalOf")} · ` : ""}{x.memo && !i.has(`txKind.${x.kind}`) ? `${x.memo} · ` : ""}{i.date(x.at)}</small>
                        </button>
                        <span className="acc-tx-fig"><small>{t("accounting.colCash")}</small><span className={`num ${BigInt(x.cash) < 0n ? "bad" : BigInt(x.cash) > 0n ? "good" : "muted"}`}>{i.signed(x.cash)}</span></span>
                        <span className="acc-tx-fig"><small>{t("accounting.colProfit")}</small>{pl === 0n ? <span className="num muted">—</span> : <Trend value={pl.toString()} text={i.signed(pl.toString())} />}</span>
                        {x.saleId ? <Button size="sm" onClick={() => onSale(x.saleId!)}>{t("accounting.saleDetail")}</Button> : <span className="acc-tx-pad" />}
                      </div>
                      {expanded ? <div className="acc-tx-lines">{x.lines.map((l, n) => <KV key={n} k={i.has(`accounts.${l.account}`) ? t(`accounts.${l.account}`) : l.account} v={<span className={`num ${BigInt(l.amount) < 0n ? "bad" : "good"}`}>{i.signed(l.amount)}</span>} />)}</div> : null}
                    </li>
                  );
                })}
              </ul>
              {cursor ? <Button loading={busy} onClick={() => void run(async () => {
                const r = await api.get<AccountingTxPageDto>("/finance/accounting/transactions", { period, before: cursor.before, beforeId: cursor.beforeId });
                setMore((m) => [...m, ...r.items]);
                setNext(r.next);
              })}>{t("accounting.loadMore")}</Button> : null}
            </>
          );
        }}
      </Async>
    </section>
  );
}

function Results({ goLedger, onSale }: { goLedger: () => void; onSale: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<OutcomeDto[]>("/finance/outcomes", undefined, ["finance", "market", "contracts", "shipments"]);
  const sales = useData<SaleDto[]>("/finance/sales", undefined, ["finance", "market", "contracts"]);
  const rows: Array<[string, keyof OutcomeFiguresDto]> = [["market.qty", "qtyKg"], ["finance.revenue", "revenue"], ["finance.goods", "goods"], ["finance.freightPaid", "freight"], ["finance.fees", "fees"], ["finance.cost", "cost"], ["finance.profit", "profit"], ["finance.time", "minutes"]];
  const fmt = (k: keyof OutcomeFiguresDto, v: OutcomeFiguresDto[keyof OutcomeFiguresDto]) => {
    if (v === null || v === undefined) return <span className="muted">—</span>;
    if (k === "qtyKg") return <span className="num">{i.qty(v as number)}</span>;
    if (k === "minutes") return <span className="num">{i.dur(v as number)}</span>;
    if (k === "profit") return <Trend value={v as string} text={i.signed(v as string)} />;
    return <span className="num">{i.money(v as string)}</span>;
  };
  return (
    <Async res={res}>
      {(list) => !list.length ? <EmptyState icon="chart" title={t("finance.noResults")} text={t("finance.noResultsText")} action={<Button variant="primary" onClick={() => open("market")}>{t("inventory.goMarket")}</Button>} /> : (
        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
          {list.map((o) => {
            const shown = rows.filter(([, k]) => o.expected[k] !== null || o.actual?.[k] != null);
            const sale = sales.data?.find((s) => o.saleIds.includes(s.id));
            return (
              <Card key={o.id} tight><div className="col tight">
                <div className="row between"><b className="nm">{t(`finance.kind.${o.kind}`)}{o.productId ? ` · ${cat.product(o.productId)}` : ""}</b><Badge tone={o.status === "settled" ? "good" : o.status === "cancelled" ? "bad" : "warn"}>{t(`finance.outcome.${o.status}`)}</Badge></div>
                <span className="muted xs">{o.recipeId ? cat.recipe(o.recipeId) : o.cityId ? `${cat.city(o.cityId)}${o.destCityId ? ` → ${cat.city(o.destCityId)}` : ""}` : ""} · {i.date(o.createdAt)}</span>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr)", gap: "4px 8px", alignItems: "baseline" }} className="small">
                  <span /><b className="xs muted" style={{ textAlign: "right" }}>{t("finance.expected")}</b><b className="xs muted" style={{ textAlign: "right" }}>{t("finance.actual")}</b>
                  {shown.map(([lk, k]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <span className="muted">{t(lk)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(k, o.expected[k])}</span>
                      <span style={{ textAlign: "right" }}>{o.actual ? fmt(k, o.actual[k]) : <span className="muted">…</span>}</span>
                    </div>
                  ))}
                </div>
                {sale ? <Button size="sm" onClick={() => onSale(sale.id)}>{t("finance.trace")}</Button> : o.ledgerTransactionIds.length ? <Button size="sm" onClick={goLedger}>{t("finance.ledger")}</Button> : null}
              </div></Card>
            );
          })}
        </div>
      )}
    </Async>
  );
}

function Sales({ onSale }: { onSale: (id: string) => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<SaleDto[]>("/finance/sales", undefined, ["finance", "market", "contracts"]);
  const cols: Col<SaleDto>[] = [
    { key: "t", head: t("finance.when"), cell: (s) => <span className="small">{i.date(s.at)}</span> },
    { key: "p", head: t("inventory.product"), cell: (s) => <><b>{cat.product(s.productId)}</b> ★{s.quality} · {i.qty(s.qtyKg)}</> },
    { key: "b", head: t("finance.buyer"), cell: (s) => <>{s.buyerName} <Badge>{t(`finance.source.${s.source}`)}</Badge></> },
    { key: "g", head: t("finance.collected"), right: true, cell: (s) => <span className="num">{i.money(s.gross)}</span> },
    { key: "c", head: t("finance.cogs"), right: true, cell: (s) => <span className="num">{i.money(s.cogs)}</span> },
    { key: "f", head: t("finance.freightPaid"), right: true, cell: (s) => <span className="num">{i.money(s.freight)}</span> },
    { key: "e", head: t("finance.fees"), right: true, cell: (s) => <span className="num">{i.money(s.fees)}</span> },
    { key: "n", head: t("finance.netProfit"), right: true, cell: (s) => <Trend value={s.netProfit} text={i.signed(s.netProfit)} /> },
  ];
  return (
    <Async res={res}>
      {(rows) => rows.length ? (
        <Table cols={cols} rows={rows} rowKey={(s) => s.id} onRow={(s) => onSale(s.id)} rowLabel={(s) => `${cat.product(s.productId)} · ${i.date(s.at)}`} />
      ) : <EmptyState icon="chart" title={t("finance.noSales")} text={t("finance.noSalesText")} action={<Button variant="primary" onClick={() => open("market")}>{t("inventory.goMarket")}</Button>} />}
    </Async>
  );
}

/** Satış muhasebesi: tahsilat − malın maliyeti − satıcının navlunu − komisyon = kalan kâr; ardından sözleşme, sevkiyat ve defter izi. */
function SaleSheet({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const tr = useData<SaleTraceDto>(saleId ? `/finance/sales/${saleId}` : null, undefined, []);
  return (
    <Sheet open={!!saleId} onClose={onClose} closeLabel={t("common.close")} wide title={t("accounting.saleTitle")}>
      {saleId ? (
        <Async res={tr} skeleton={<SkeletonList n={3} />}>
          {(d) => {
            const s = d.sale;
            const seller = s.viewerRole === "seller";
            const gross = BigInt(s.gross);
            const pct = (v: string) => (gross > 0n ? Number((BigInt(v) * 10000n) / gross) : 0);
            const steps: Array<[string, string]> = [["accounting.cogs", s.cogs], ["accounting.freight", s.freight], ["accounting.fees", s.fees]];
            return (
              <div className="col">
                <div className="acc-sale-head"><b>{cat.product(s.productId)} ★{s.quality} · {i.qty(s.qtyKg)}</b><span className="muted small">{i.price(s.pricePerKg)} · {cat.city(s.cityId)} · {i.date(s.at)}</span><span className="small">{seller ? `${t("finance.buyer")}: ${s.buyerName}` : `${t("offers.seller")}: ${s.sellerName}`} <Badge>{t(`finance.source.${s.source}`)}</Badge></span></div>
                {seller ? (
                  <div className="acc-receipt" role="table" aria-label={t("accounting.saleTitle")}>
                    <div role="row" className="acc-rline"><span role="rowheader">{t("accounting.collected")}</span><b role="cell" className="num">{i.money(s.gross)}</b><i className="acc-bar rev" style={{ width: "100%" }} aria-hidden="true" /></div>
                    {steps.map(([k, v]) => <div role="row" key={k} className="acc-rline"><span role="rowheader">− {t(k)}</span><span role="cell" className="num">− {i.money(v)}</span><i className="acc-bar exp" style={{ width: `${pct(v) / 100}%` }} aria-hidden="true" /></div>)}
                    <div role="row" className="acc-rline total"><span role="rowheader"><b>= {t("accounting.remaining")}</b></span><b role="cell"><Trend value={s.netProfit} text={i.signed(s.netProfit)} /></b><span className="xs muted">{t("accounting.margin", { p: i.pct(pct(s.netProfit)) })}</span></div>
                  </div>
                ) : (
                  <>
                    <KV k={t("accounting.paid")} v={<b className="num">{i.money(s.gross)}</b>} />
                    <Notice tone="steel">{t("accounting.buyerView")}</Notice>
                  </>
                )}
                <h4>{t("finance.traceChain")}</h4>
                <div className="notice steel col tight">
                  <span>1. {d.contract ? `${t("panels.contracts")}: ${i.price(d.contract.pricePerKg)} · ${cat.city(d.contract.deliveryCityId)} (${t(`contracts.status.${d.contract.status}`)})` : t("finance.noContract")}</span>
                  {d.installment ? <span>{t("contracts.installment")} #{d.installment.seq} · {i.date(d.installment.dueAt)}</span> : null}
                  <span>2. {d.shipment ? `${t("logistics.shipment")}: ${cat.city(d.shipment.originCityId)} → ${cat.city(d.shipment.destCityId)} (${d.shipment.deliveredAt ? i.date(d.shipment.deliveredAt) : t("logistics.inTransit")})` : t("finance.noShipment")}</span>
                  {seller ? <span>3. {t("finance.ledgerTx", { n: d.transactions.length })}</span> : null}
                </div>
                {seller ? d.transactions.map((x) => (
                  <Disclosure key={x.id} summary={`${i.kind(x.kind)} · ${i.date(x.at)}`}>
                    {x.memo ? <span className="muted small">{x.memo}</span> : null}
                    {x.lines.map((l, n) => <KV key={n} k={i.has(`accounts.${l.account}`) ? t(`accounts.${l.account}`) : l.account} v={<span className={BigInt(l.amount) < 0n ? "bad" : "good"}>{i.signed(l.amount)}</span>} />)}
                  </Disclosure>
                )) : null}
              </div>
            );
          }}
        </Async>
      ) : null}
    </Sheet>
  );
}

function Ledger() {
  const i = useT();
  const { t } = i;
  const first = useData<LedgerLineDto[]>("/finance/ledger", undefined, ["finance"]);
  const [more, setMore] = useState<LedgerLineDto[]>([]);
  const [done, setDone] = useState(false);
  const { run, busy } = useAction();
  return (
    <Async res={first}>
      {(rows) => {
        const all = [...rows, ...more];
        if (!all.length) return <EmptyState icon="doc" title={t("finance.noLedger")} />;
        const last = all[all.length - 1]!;
        return (
          <div className="col">
            {all.map((l, n) => (
              <div key={`${l.transactionId}-${l.account}-${n}`} className="li">
                <div className="grow col tight"><span className="small"><b>{i.kind(l.kind)}</b> · {i.has(`accounts.${l.account}`) ? t(`accounts.${l.account}`) : l.account}</span><span className="xs muted">{l.memo} · {i.date(l.at)}</span></div>
                <span className={`num ${BigInt(l.amount) < 0n ? "bad" : "good"}`}>{i.signed(l.amount)}</span>
              </div>
            ))}
            {!done ? <Button loading={busy} onClick={() => void run(async () => { const r = await api.get<LedgerLineDto[]>("/finance/ledger", { before: last.at }); if (!r.length) setDone(true); setMore((m) => [...m, ...r]); }, { silent: false })}>{t("common.loadMore")}</Button> : null}
          </div>
        );
      }}
    </Async>
  );
}

function Loans() {
  const i = useT();
  const { t } = i;
  const res = useFinance();
  const { run, busy } = useAction();
  const [amount, setAmount] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  return (
    <Async res={res}>
      {(f) => {
        const termDays = Number(term || f.loanOffer.termsDays[0] || 7);
        const arrears = f.balances.arrears && f.balances.arrears !== "0" ? f.balances.arrears : null;
        return (
          <div className="col">
            {arrears ? <Notice tone="bad">⚠ {t("finance.arrears")}: <b>{i.money(arrears)}</b> — {t("finance.arrearsHint")}<Button size="sm" loading={busy} onClick={() => void run(() => api.post("/finance/arrears/pay"), { ok: "finance.arrearsPaid" })}>{t("finance.payArrears")}</Button></Notice> : null}
            <Card><div className="col">
              <h4>{t("finance.offer")}</h4>
              {f.loanOffer.maxAmount === "0" ? <p className="muted small">{t("finance.noOffer")}</p> : (
                <>
                  <KV k={t("finance.maxAmount")} v={i.money(f.loanOffer.maxAmount)} />
                  <KV k={t("finance.dailyRate")} v={i.pct(f.loanOffer.dailyInterestBp)} />
                  <MoneyInput label={t("finance.amount")} value={amount} onChange={setAmount} />
                  <SelectField label={t("finance.term")} value={String(termDays)} onChange={setTerm} options={f.loanOffer.termsDays.map((d) => ({ id: String(d), label: t("finance.days", { n: d }) }))} />
                  <Button variant="primary" loading={busy} disabled={!amount} onClick={() => void run(() => api.post("/finance/loans", { amount, termDays }), { ok: "finance.loanTaken" }).then((r) => { if (r) setAmount(null); })}>{t("finance.takeLoan")}</Button>
                </>
              )}
            </div></Card>
            <h4>{t("finance.myLoans")}</h4>
            {f.loans.length ? f.loans.map((l) => <LoanCard key={l.id} l={l} />) : <p className="muted small">{t("finance.noLoans")}</p>}
          </div>
        );
      }}
    </Async>
  );
}

function LoanCard({ l }: { l: LoanDto }) {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const [amt, setAmt] = useState<number | null>(null);
  return (
    <Card><div className="col tight">
      <div className="row between"><b>{i.money(l.principal)}</b><Badge tone={l.status === "active" ? "warn" : l.status === "repaid" ? "good" : "bad"}>{t(`finance.loanStatus.${l.status}`)}</Badge></div>
      <KV k={t("finance.outstanding")} v={i.money(l.outstanding)} />
      <KV k={t("finance.installment")} v={i.money(l.installment)} />
      <KV k={t("finance.dailyRate")} v={i.pct(l.dailyInterestBp)} />
      <KV k={t("finance.interestPaid")} v={i.money(l.interestPaid)} />
      {l.nextDueAt && l.status === "active" ? <KV k={t("finance.nextDue")} v={<><Countdown until={l.nextDueAt} /> ({i.date(l.nextDueAt)})</>} /> : null}
      {l.status === "active" ? (
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><MoneyInput label={t("finance.repayAmount")} value={amt} onChange={setAmt} /></div>
          <Button loading={busy} disabled={!amt} onClick={() => void run(() => api.post(`/finance/loans/${l.id}/repay`, { amount: amt }), { ok: "finance.repaid" }).then((r) => { if (r) setAmt(null); })}>{t("finance.repay")}</Button>
        </div>
      ) : null}
    </div></Card>
  );
}
