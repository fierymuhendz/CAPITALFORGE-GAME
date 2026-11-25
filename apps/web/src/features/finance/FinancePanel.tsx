"use client";
import { useState } from "react";
import type { FinanceDto, LedgerLineDto, LoanDto, OutcomeDto, OutcomeFiguresDto, SaleDto, SaleTraceDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, Disclosure, EmptyState, KV, MoneyInput, Notice, SelectField, Sheet, SkeletonList, Stat, Table, Tabs, Trend, type Col } from "@/ui";
import { usePlay } from "../play/context";

export function FinancePanel() {
  const { t } = useT();
  const [tab, setTab] = useState("overview");
  return (
    <div className="col">
      <Tabs label={t("panels.finance")} value={tab} onChange={setTab} items={[{ id: "overview", label: t("finance.overview") }, { id: "results", label: t("finance.results") }, { id: "sales", label: t("finance.sales") }, { id: "ledger", label: t("finance.ledger") }, { id: "loans", label: t("finance.loans") }]} />
      {tab === "overview" ? <Overview /> : tab === "results" ? <Results goLedger={() => setTab("ledger")} /> : tab === "sales" ? <Sales /> : tab === "ledger" ? <Ledger /> : <Loans />}
    </div>
  );
}

const useFinance = () => useData<FinanceDto>("/finance", undefined, ["finance", "company"]);

function Overview() {
  const i = useT();
  const { t } = i;
  const res = useFinance();
  return (
    <Async res={res}>
      {(f) => (
        <div className="col">
          <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
            <Card tight><Stat label={t("finance.netWorth")} value={<span className="money-big">{i.money(f.netWorth)}</span>} /></Card>
            <Card tight><Stat label={t("finance.cash")} value={<span className="money-big">{i.money(f.balances.cash ?? "0")}</span>} /></Card>
          </div>
          <Card><div className="col tight">
            <h4>{t("finance.pnl")} <span className="muted small">({t("finance.lastDays", { n: f.pnl.days })})</span></h4>
            <KV k={t("finance.revenue")} v={i.money(f.pnl.revenue)} />
            <KV k={t("finance.cogs")} v={i.money(f.pnl.cogs)} />
            <KV k={t("finance.grossProfit")} v={<Trend value={f.pnl.grossProfit} text={i.signed(f.pnl.grossProfit)} />} />
            <hr className="sep" />
            <KV k={<b>{t("finance.netProfit")}</b>} v={<b><Trend value={f.pnl.netProfit} text={i.signed(f.pnl.netProfit)} /></b>} />
          </div></Card>
          <Disclosure summary={t("finance.expenses")}>
            {Object.entries(f.pnl.expenses).map(([k, v]) => <KV key={k} k={i.has(`accounts.${k}`) ? t(`accounts.${k}`) : k} v={i.money(v)} />)}
          </Disclosure>
          <Disclosure summary={t("finance.cashflow")}>
            <KV k={t("finance.operating")} v={<Trend value={f.cashflow.operating} text={i.signed(f.cashflow.operating)} />} />
            <KV k={t("finance.investing")} v={<Trend value={f.cashflow.investing} text={i.signed(f.cashflow.investing)} />} />
            <KV k={t("finance.financing")} v={<Trend value={f.cashflow.financing} text={i.signed(f.cashflow.financing)} />} />
            <KV k={<b>{t("finance.netCash")}</b>} v={<b><Trend value={f.cashflow.net} text={i.signed(f.cashflow.net)} /></b>} />
          </Disclosure>
          <Disclosure summary={t("finance.balances")}>
            {Object.entries(f.balances).map(([k, v]) => <KV key={k} k={i.has(`accounts.${k}`) ? t(`accounts.${k}`) : k} v={i.money(v)} />)}
          </Disclosure>
        </div>
      )}
    </Async>
  );
}

function Results({ goLedger }: { goLedger: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<OutcomeDto[]>("/finance/outcomes", undefined, ["finance", "market", "contracts", "shipments"]);
  const sales = useData<SaleDto[]>("/finance/sales", undefined, ["finance", "market", "contracts"]);
  const [sel, setSel] = useState<SaleDto | null>(null);
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
                {sale ? <Button size="sm" onClick={() => setSel(sale)}>{t("finance.trace")}</Button> : o.ledgerTransactionIds.length ? <Button size="sm" onClick={goLedger}>{t("finance.ledger")}</Button> : null}
              </div></Card>
            );
          })}
          <SaleSheet sale={sel} onClose={() => setSel(null)} />
        </div>
      )}
    </Async>
  );
}

function Sales() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { open } = usePlay();
  const res = useData<SaleDto[]>("/finance/sales", undefined, ["finance", "market", "contracts"]);
  const [sel, setSel] = useState<SaleDto | null>(null);
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
        <div className="col"><Table cols={cols} rows={rows} rowKey={(s) => s.id} onRow={setSel} rowLabel={(s) => cat.product(s.productId)} /><SaleSheet sale={sel} onClose={() => setSel(null)} /></div>
      ) : <EmptyState icon="chart" title={t("finance.noSales")} text={t("finance.noSalesText")} action={<Button variant="primary" onClick={() => open("market")}>{t("inventory.goMarket")}</Button>} />}
    </Async>
  );
}

function SaleSheet({ sale, onClose }: { sale: SaleDto | null; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const tr = useData<SaleTraceDto>(sale ? `/finance/sales/${sale.id}` : null, undefined, []);
  return (
    <Sheet open={!!sale} onClose={onClose} closeLabel={t("common.close")} wide title={t("finance.trace")}>
      {sale ? (
        <div className="col">
          <KV k={t("finance.collected")} v={i.money(sale.gross)} />
          <KV k={t("finance.cogs")} v={`− ${i.money(sale.cogs)}`} />
          <KV k={t("finance.freightPaid")} v={`− ${i.money(sale.freight)}`} />
          <KV k={t("finance.fees")} v={`− ${i.money(sale.fees)}`} />
          <KV k={<b>{t("finance.netProfit")}</b>} v={<b><Trend value={sale.netProfit} text={i.signed(sale.netProfit)} /></b>} />
          <Async res={tr} skeleton={<SkeletonList n={2} />}>
            {(d) => (
              <div className="col tight">
                <h4>{t("finance.traceChain")}</h4>
                <div className="notice steel col tight">
                  <span>1. {d.contract ? `${t("panels.contracts")}: ${i.price(d.contract.pricePerKg)} · ${cat.city(d.contract.deliveryCityId)} (${t(`contracts.status.${d.contract.status}`)})` : t("finance.noContract")}</span>
                  {d.installment ? <span>{t("contracts.installment")} #{d.installment.seq} · {i.date(d.installment.dueAt)}</span> : null}
                  <span>2. {d.shipment ? `${t("logistics.shipment")}: ${cat.city(d.shipment.originCityId)} → ${cat.city(d.shipment.destCityId)} (${d.shipment.deliveredAt ? i.date(d.shipment.deliveredAt) : t("logistics.inTransit")})` : t("finance.noShipment")}</span>
                  <span>3. {t("finance.ledgerTx", { n: d.transactions.length })}</span>
                </div>
                {d.transactions.map((x) => (
                  <div key={x.id} className="card flat tight col tight">
                    <div className="row between"><b className="small">{i.kind(x.kind)}</b><span className="muted xs">{i.date(x.at)}</span></div>
                    <span className="muted small">{x.memo}</span>
                    {x.lines.map((l, n) => <KV key={n} k={i.has(`accounts.${l.account}`) ? t(`accounts.${l.account}`) : l.account} v={<span className={BigInt(l.amount) < 0n ? "bad" : "good"}>{i.signed(l.amount)}</span>} />)}
                  </div>
                ))}
              </div>
            )}
          </Async>
        </div>
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
