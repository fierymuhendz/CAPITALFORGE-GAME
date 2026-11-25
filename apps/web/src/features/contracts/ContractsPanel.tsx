"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ContractCompareDto, ContractDetailDto, ContractDto, InstallmentDto } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, Countdown, Disclosure, EmptyState, KV, Notice, QtyInput, SelectField, Sheet, SkeletonList, SystemBadge, Tabs } from "@/ui";
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
  const cat = useCat();
  const res = useData<ContractDetailDto>(id ? `/contracts/${id}` : null, undefined, ["contracts", "shipments"]);
  const d = res.data;
  return (
    <Sheet open={!!id} onClose={onClose} closeLabel={t("common.close")} wide title={d ? `${cat.product(d.contract.productId)} ★${d.contract.minQuality}+` : t("contracts.detail")}
      footer={d ? <Actions c={d.contract} onClose={onClose} /> : undefined}>
      {id ? <Async res={res} skeleton={<SkeletonList n={3} />}>{(x) => <DetailBody d={x} />}</Async> : null}
    </Sheet>
  );
}

function roleOf(c: ContractDto): "seller" | "buyer" | null {
  return c.myRole ?? (c.status === "proposed" ? (c.sellerCompanyId ? "buyer" : "seller") : null);
}

function Actions({ c, onClose }: { c: ContractDto; onClose: () => void }) {
  const { t } = useT();
  const { run, busy } = useAction();
  const act = (path: string, ok: string) => void run(() => api.post(`/contracts/${c.id}/${path}`), { ok }).then((r) => { if (r) onClose(); });
  const proposedByMe = c.myRole === (c.sellerCompanyId === c.proposerCompanyId ? "seller" : "buyer");
  if (c.status === "proposed" && !proposedByMe) return <><Button variant="primary" loading={busy} onClick={() => act("accept", "contracts.accepted")}>{t("contracts.accept")}</Button>{!c.isPublic ? <Button loading={busy} onClick={() => act("decline", "contracts.declined")}>{t("contracts.decline")}</Button> : null}</>;
  if (c.status === "proposed") return <Button loading={busy} onClick={() => act("withdraw", "contracts.withdrawn")}>{t("contracts.withdraw")}</Button>;
  if (c.status === "active" && c.myRole) return <Button variant="danger" loading={busy} onClick={() => { if (window.confirm(t("contracts.cancelConfirm"))) act("cancel", "contracts.cancelled"); }}>{t("contracts.cancel")}</Button>;
  return <Button onClick={onClose}>{t("common.close")}</Button>;
}

function CompareCard({ c, role }: { c: ContractDto; role: "seller" | "buyer" }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useData<ContractCompareDto>(`/contracts/${c.id}/compare`, undefined, ["contracts", "market", "inventory"]);
  const k = res.data;
  if (!k) return res.error ? null : <SkeletonList n={1} h={96} />;
  const sold = k.myRole === "seller";
  return (
    <Card flat><div className="col tight">
      <h4>{t("contracts.compare.title")}</h4>
      <div className="two">
        <div className="col tight"><span className="muted xs">{t("contracts.compare.contract")}</span><b className="num">{i.money(k.total.net)}</b><span className="muted xs num">{i.price(k.perInstallment.perKg)}</span></div>
        <div className="col tight"><span className="muted xs">{sold ? t("contracts.compare.spot") : t("contracts.compare.spotBuy")}</span>{k.spotNow ? <><b className="num">{i.money(k.spotNow.net)}</b><span className="muted xs num">{i.price(k.spotNow.perKg)} · {cat.city(k.spotNow.cityId)}</span></> : <span className="muted small">{t(sold ? "contracts.compare.noSpot" : "contracts.compare.noSeller")}</span>}</div>
      </div>
      <span className="muted xs">{t("contracts.compare.netNote", { q: i.qty(k.total.qtyKg) })}</span>
      <KV k={t("contracts.compare.goodsFreight")} v={`${i.money(k.total.goods)} − ${i.money(k.total.freight)} − ${i.money(k.total.fees)}`} />
      <KV k={role === "seller" ? t("contracts.sellerDeposit") : t("contracts.buyerEscrow")} v={i.money(role === "seller" ? k.commitment.sellerDeposit : k.commitment.buyerEscrow)} />
      <KV k={t("contracts.compare.penalty")} v={<span className="warn">{i.money(k.commitment.penaltyPerMissed)}</span>} />
      <KV k={t("contracts.compare.schedule")} v={t("contracts.compare.scheduleV", { n: k.schedule.installments, h: k.schedule.intervalHours })} />
      <KV k={t("contracts.compare.window")} v={`${i.date(k.schedule.firstDueAt)} → ${i.date(k.schedule.lastDueAt)}`} />
      {sold ? <KV k={t("contracts.compare.stock")} v={<span className={k.myStockKg < k.total.qtyKg ? "warn" : "good"}>{i.qty(k.myStockKg)}</span>} /> : null}
      {k.avgCostPerKg ? <KV k={t("contracts.compare.myCost")} v={i.price(k.avgCostPerKg)} /> : null}
    </div></Card>
  );
}

function DetailBody({ d }: { d: ContractDetailDto }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const c = d.contract;
  const iWouldBe = roleOf(c);
  const payerIsMe = iWouldBe === c.freightPayer;
  const proposedByMe = c.myRole === (c.sellerCompanyId === c.proposerCompanyId ? "seller" : "buyer");
  return (
    <div className="col">
      <div className="row between wrap"><Badge tone={statusTone(c.status)}>{t(`contracts.status.${c.status}`)}</Badge>{c.status === "proposed" ? <span className="muted small">{t("contracts.expires")}: <Countdown until={c.expiresAt} doneText={t("logistics.expired")} /></span> : null}</div>
      <Card flat><div className="col tight">
        <KV k={t("contracts.seller")} v={<span className="nm" style={{ textAlign: "right" }}>{c.sellerName ?? t("contracts.openSlot")}</span>} />
        <KV k={t("contracts.buyer")} v={<span className="nm" style={{ textAlign: "right" }}>{c.buyerName ?? t("contracts.openSlot")}</span>} />
        <KV k={t("market.price")} v={<b>{i.price(c.pricePerKg)}</b>} />
        <KV k={t("contracts.qtyPer")} v={`${i.qty(c.qtyPerInstallmentKg)} × ${c.installments}`} />
        <KV k={t("contracts.total")} v={<b>{i.money(c.totalValue)}</b>} />
        <KV k={t("contracts.deliveryCity")} v={cat.city(c.deliveryCityId)} />
        <KV k={t("contracts.firstDue")} v={`${i.date(c.firstDueAt)} · ${t("contracts.every", { n: c.intervalHours })}`} />
        <KV k={t("contracts.freightPayer")} v={<span>{t(`contracts.role.${c.freightPayer}`)}{iWouldBe ? <b className={payerIsMe ? "warn" : "good"}> ({payerIsMe ? t("contracts.you") : t("contracts.other")})</b> : null}</span>} />
      </div></Card>
      {c.status === "proposed" && iWouldBe && !proposedByMe ? <CompareCard c={c} role={iWouldBe} /> : null}
      <Disclosure summary={t("contracts.moreTerms")}>
        {c.sellerReputationBp !== null ? <KV k={`${t("contracts.seller")} · ${t("company.reputation")}`} v={i.pct(c.sellerReputationBp)} /> : null}
        {c.buyerReputationBp !== null ? <KV k={`${t("contracts.buyer")} · ${t("company.reputation")}`} v={i.pct(c.buyerReputationBp)} /> : null}
        <KV k={t("contracts.grace")} v={t("contracts.everyHours", { n: c.graceHours })} />
        <KV k={t("contracts.missingPenalty")} v={i.pct(c.penaltyBp)} />
        <KV k={t("contracts.latePenalty")} v={i.pct(c.lateFeeBp)} />
        <KV k={t("contracts.buyerEscrow")} v={i.money(c.buyerEscrow)} />
        <KV k={t("contracts.sellerDeposit")} v={i.money(c.sellerDeposit)} />
        <KV k={t("contracts.cancelTerms")} v={t("contracts.cancelHint")} />
        <KV k={t("contracts.freightWho.title")} v={t(`contracts.freightWho.${c.freightPayer}`)} />
        {c.note ? <KV k={t("contracts.note")} v={c.note} /> : null}
      </Disclosure>

      {c.status !== "proposed" ? (
        <>
          <Disclosure summary={t("contracts.whoOwes")}>
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
          </Disclosure>
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
          <Sheet open={open} onClose={() => setOpen(false)} closeLabel={t("common.close")} title={`${t("contracts.deliver")} #${s.seq}`}
            footer={<Button variant="primary" loading={busy} disabled={!qty} onClick={() => void run(() => api.post(`/contracts/installments/${s.id}/deliver`, { qtyKg: qty, quality: Number(q) }), { ok: "contracts.delivered" }).then((r) => { if (r) setOpen(false); })}>{t("contracts.deliver")}</Button>}>
            <div className="col">
              <QtyInput label={t("market.qty")} value={qty} onChange={setQty} max={s.outstandingKg} />
              <SelectField label={t("common.quality")} value={q} onChange={setQ} options={[1, 2, 3, 4, 5].filter((n) => n >= c.minQuality).map((n) => ({ id: String(n), label: `★${n}` }))} />
            </div>
          </Sheet>
        </>
      ) : null}
    </div></Card>
  );
}
