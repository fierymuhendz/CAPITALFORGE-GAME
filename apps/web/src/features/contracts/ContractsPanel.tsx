"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ContractDetailDto, ContractDto, InstallmentDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, EmptyState, KV, Notice, QtyInput, SelectField, Sheet, SkeletonList, SystemBadge, Tabs } from "@/ui";
import { NewOffer } from "./NewOffer";

export function ContractsPanel() {
  const { t } = useT();
  const sp = useSearchParams();
  const linked = sp.get("id");
  const [tab, setTab] = useState(linked ? "mine" : "board");
  const [openId, setOpenId] = useState<string | null>(linked);
  useEffect(() => { if (linked) { setOpenId(linked); setTab("mine"); } }, [linked]);
  return (
    <div className="col">
      <Tabs label={t("panels.contracts")} value={tab} onChange={setTab} items={[{ id: "board", label: t("contracts.board") }, { id: "mine", label: t("contracts.mine") }, { id: "new", label: t("contracts.new") }]} />
      {tab === "new" ? <NewOffer onDone={() => setTab("mine")} /> : <List scope={tab === "mine" ? "mine" : "board"} onOpen={setOpenId} goNew={() => setTab("new")} />}
      <Detail id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function statusTone(s: ContractDto["status"]): "good" | "bad" | "warn" | "forge" | undefined {
  return s === "active" ? "good" : s === "completed" ? "good" : s === "proposed" ? "warn" : s === "cancelled" || s === "declined" || s === "expired" ? "bad" : undefined;
}

function List({ scope, onOpen, goNew }: { scope: "board" | "mine"; onOpen: (id: string) => void; goNew: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useList<ContractDto>("/contracts", { scope }, ["contracts"]);
  return (
    <Async res={res}>
      {(rows) => !rows.length ? (
        <EmptyState icon="doc" title={t(scope === "board" ? "contracts.emptyBoard" : "contracts.emptyMine")} text={t(scope === "board" ? "contracts.emptyBoardText" : "contracts.emptyMineText")} action={<Button variant="primary" onClick={goNew}>{t("contracts.new")}</Button>} />
      ) : (
        <div className="col">{rows.map((c) => (
          <Card key={c.id} onClick={() => onOpen(c.id)}><div className="col tight">
            <div className="row between wrap"><b>{cat.product(c.productId)} ★{c.minQuality}+</b><span className="row">{c.isSystem ? <SystemBadge /> : null}{c.myRole ? <Badge tone="forge">{t(`contracts.role.${c.myRole}`)}</Badge> : null}<Badge tone={statusTone(c.status)}>{t(`contracts.status.${c.status}`)}</Badge></span></div>
            <span className="small muted2">{i.qty(c.qtyPerInstallmentKg)} × {c.installments} · <b>{i.price(c.pricePerKg)}</b> · {cat.city(c.deliveryCityId)}</span>
            <span className="small muted">{c.sellerName ?? "—"} → {c.buyerName ?? "—"}</span>
            <div className="row between small"><span>{t("contracts.total")}: <b className="num">{i.money(c.totalValue)}</b></span>{c.status === "proposed" ? <span className="muted">{t("contracts.expires")}: <Countdown until={c.expiresAt} doneText={t("logistics.expired")} /></span> : null}</div>
          </div></Card>
        ))}</div>
      )}
    </Async>
  );
}

function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT();
  const res = useData<ContractDetailDto>(id ? `/contracts/${id}` : null, undefined, ["contracts", "shipments"]);
  return (
    <Sheet open={!!id} onClose={onClose} closeLabel={t("common.close")} wide title={t("contracts.detail")}>
      {id ? <Async res={res} skeleton={<SkeletonList n={3} />}>{(d) => <DetailBody d={d} onClose={onClose} />}</Async> : null}
    </Sheet>
  );
}

function pctBp(i: ReturnType<typeof useT>, bp: number) { return i.pct(bp); }

function DetailBody({ d, onClose }: { d: ContractDetailDto; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const c = d.contract;
  const act = (path: string, ok: string, close = true) => void run(() => api.post(`/contracts/${c.id}/${path}`), { ok }).then((r) => { if (r && close) onClose(); });
  const iWouldBe: "seller" | "buyer" | null = c.myRole ?? (c.status === "proposed" ? (c.sellerCompanyId ? "buyer" : "seller") : null);
  const proposedByMe = c.myRole === (c.sellerCompanyId === c.proposerCompanyId ? "seller" : "buyer");
  const payerIsMe = iWouldBe === c.freightPayer;
  return (
    <div className="col">
      <div className="row between wrap"><h3>{cat.product(c.productId)} ★{c.minQuality}+</h3><Badge tone={statusTone(c.status)}>{t(`contracts.status.${c.status}`)}</Badge></div>

      <Card flat><div className="col tight">
        <h4>{t("contracts.terms")}</h4>
        <KV k={t("contracts.seller")} v={<>{c.sellerName ?? t("contracts.openSlot")} {c.sellerReputationBp !== null ? <span className="muted xs">({t("company.reputation")} {i.pct(c.sellerReputationBp)})</span> : null}</>} />
        <KV k={t("contracts.buyer")} v={<>{c.buyerName ?? t("contracts.openSlot")} {c.buyerReputationBp !== null ? <span className="muted xs">({t("company.reputation")} {i.pct(c.buyerReputationBp)})</span> : null}</>} />
        <KV k={t("inventory.product")} v={cat.product(c.productId)} />
        <KV k={t("market.minQuality")} v={`★${c.minQuality}`} />
        <KV k={t("contracts.qtyPer")} v={i.qty(c.qtyPerInstallmentKg)} />
        <KV k={t("contracts.installments")} v={c.installments} />
        <KV k={t("market.price")} v={<b>{i.price(c.pricePerKg)}</b>} />
        <KV k={t("contracts.total")} v={<b>{i.money(c.totalValue)}</b>} />
        <KV k={t("contracts.deliveryCity")} v={cat.city(c.deliveryCityId)} />
        <KV k={t("contracts.freightPayer")} v={<>{t(`contracts.role.${c.freightPayer}`)}{iWouldBe ? <b className={payerIsMe ? "warn" : "good"}> ({payerIsMe ? t("contracts.you") : t("contracts.other")})</b> : null}</>} />
        <KV k={t("contracts.freightWho.title")} v={t(`contracts.freightWho.${c.freightPayer}`)} />
        <KV k={t("contracts.firstDue")} v={i.date(c.firstDueAt)} />
        <KV k={t("contracts.interval")} v={t("contracts.everyHours", { n: c.intervalHours })} />
        <KV k={t("contracts.grace")} v={t("contracts.everyHours", { n: c.graceHours })} />
        <KV k={t("contracts.missingPenalty")} v={`${pctBp(i, c.penaltyBp)} — ${t("contracts.missingPenaltyHint")}`} />
        <KV k={t("contracts.latePenalty")} v={`${pctBp(i, c.lateFeeBp)} — ${t("contracts.latePenaltyHint")}`} />
        <KV k={t("contracts.cancelTerms")} v={t("contracts.cancelHint")} />
        <KV k={t("contracts.buyerEscrow")} v={i.money(c.buyerEscrow)} />
        <KV k={t("contracts.sellerDeposit")} v={i.money(c.sellerDeposit)} />
        {c.note ? <KV k={t("contracts.note")} v={c.note} /> : null}
        {c.status === "proposed" ? <KV k={t("contracts.expires")} v={<Countdown until={c.expiresAt} doneText={t("logistics.expired")} />} /> : null}
      </div></Card>

      {c.status === "proposed" && iWouldBe ? (
        <Notice tone="warn"><span>{iWouldBe === "buyer" ? t("contracts.acceptBuyer", { amount: i.money(c.buyerEscrow) }) : t("contracts.acceptSeller", { amount: i.money(c.sellerDeposit) })}</span></Notice>
      ) : null}
      <div className="row wrap">
        {c.status === "proposed" && !proposedByMe ? <Button variant="primary" loading={busy} onClick={() => act("accept", "contracts.accepted")}>{t("contracts.accept")}</Button> : null}
        {c.status === "proposed" && !proposedByMe && !c.isPublic ? <Button loading={busy} onClick={() => act("decline", "contracts.declined")}>{t("contracts.decline")}</Button> : null}
        {c.status === "proposed" && proposedByMe ? <Button loading={busy} onClick={() => act("withdraw", "contracts.withdrawn")}>{t("contracts.withdraw")}</Button> : null}
        {c.status === "active" && c.myRole ? <Button variant="danger" loading={busy} onClick={() => { if (window.confirm(t("contracts.cancelConfirm"))) act("cancel", "contracts.cancelled"); }}>{t("contracts.cancel")}</Button> : null}
      </div>

      {c.status !== "proposed" ? (
        <>
          <Card flat><div className="col tight">
            <h4>{t("contracts.whoOwes")}</h4>
            <p className="small">{c.sellerName}: {t("contracts.owesKg", { q: i.qty(d.balances.seller.owedKg) })} · {t("contracts.deliveredKg", { q: i.qty(d.balances.seller.delivered) })}</p>
            <KV k={t("contracts.sellerReceived")} v={i.money(d.balances.seller.received)} />
            <KV k={t("contracts.depositHeld")} v={i.money(d.balances.seller.depositHeld)} />
            <KV k={t("contracts.penaltiesPaid")} v={i.money(d.balances.seller.penaltiesPaid)} />
            <hr className="sep" />
            <p className="small">{c.buyerName}: {t("contracts.escrowHeldText", { a: i.money(d.balances.buyer.escrowHeld) })}</p>
            <KV k={t("contracts.buyerPaid")} v={i.money(d.balances.buyer.paid)} />
            <KV k={t("contracts.buyerReceived")} v={i.qty(d.balances.buyer.received)} />
            <KV k={t("contracts.refunds")} v={i.money(d.balances.buyer.refunds)} />
            <KV k={t("contracts.penaltiesReceived")} v={i.money(d.balances.buyer.penaltiesReceived)} />
          </div></Card>
          <h4>{t("contracts.schedule")}</h4>
          {d.schedule.map((s) => <InstallmentCard key={s.id} s={s} c={c} />)}
        </>
      ) : null}
    </div>
  );
}

function InstallmentCard({ s, c }: { s: InstallmentDto; c: ContractDto }) {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<number | null>(null);
  const [q, setQ] = useState(String(c.minQuality));
  const tone = s.status === "fulfilled" ? "good" : s.status === "missed" || s.status === "cancelled" ? "bad" : s.status === "open" || s.status === "partial" ? "warn" : undefined;
  return (
    <Card tight><div className="col tight">
      <div className="row between"><b>#{s.seq} · {i.date(s.dueAt)}</b><Badge tone={tone}>{t(`contracts.instStatus.${s.status}`)}</Badge></div>
      <span className="small muted2">{t("contracts.window")}: {i.date(s.windowOpensAt)} → {i.date(s.graceEndsAt)}</span>
      <KV k={t("contracts.dueKg")} v={`${i.qty(s.qtyDeliveredKg)} / ${i.qty(s.qtyDueKg)}${s.qtyLateKg ? ` (${t("contracts.lateKg", { q: i.qty(s.qtyLateKg) })})` : ""}`} />
      <KV k={t("contracts.outstanding")} v={i.qty(s.outstandingKg)} />
      <KV k={t("contracts.escrowRemaining")} v={i.money(s.escrowRemaining)} />
      {s.paidToSeller !== "0" ? <KV k={t("contracts.paidToSeller")} v={i.money(s.paidToSeller)} /> : null}
      {s.lateFees !== "0" ? <KV k={t("contracts.lateFees")} v={i.money(s.lateFees)} /> : null}
      {s.penalty !== "0" ? <KV k={t("contracts.penalty")} v={i.money(s.penalty)} /> : null}
      {s.refundedToBuyer !== "0" ? <KV k={t("contracts.refundedBuyer")} v={i.money(s.refundedToBuyer)} /> : null}
      {s.deliveries.map((x) => <div key={x.id} className="small muted2">✓ {i.date(x.at)} · {i.qty(x.qtyKg)} ★{x.quality}{x.late ? ` · ${t("contracts.late")}` : ""}{x.shipmentId ? ` · ${t("logistics.shipment")} ${x.shipmentId.slice(0, 8)}` : ""}</div>)}
      {s.freightJobId ? <span className="xs muted">{t("contracts.linkedJob")}: {s.freightJobId.slice(0, 8)}</span> : null}
      {c.myRole === "seller" && (s.status === "open" || s.status === "partial") ? (
        <>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>{t("contracts.deliver")}</Button>
          <Sheet open={open} onClose={() => setOpen(false)} closeLabel={t("common.close")} title={`${t("contracts.deliver")} #${s.seq}`}>
            <div className="col">
              <Notice tone="steel">{t("contracts.deliverHint")}</Notice>
              <QtyInput label={t("market.qty")} value={qty} onChange={setQty} max={s.outstandingKg} />
              <SelectField label={t("common.quality")} value={q} onChange={setQ} options={[1, 2, 3, 4, 5].filter((n) => n >= c.minQuality).map((n) => ({ id: String(n), label: `★${n}` }))} />
              <Button variant="primary" loading={busy} disabled={!qty} onClick={() => void run(() => api.post(`/contracts/installments/${s.id}/deliver`, { qtyKg: qty, quality: Number(q) }), { ok: "contracts.delivered" }).then((r) => { if (r) setOpen(false); })}>{t("contracts.deliver")}</Button>
            </div>
          </Sheet>
        </>
      ) : null}
    </div></Card>
  );
}
