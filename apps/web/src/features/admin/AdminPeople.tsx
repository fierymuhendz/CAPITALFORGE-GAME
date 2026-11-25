"use client";
import { useState } from "react";
import type { AdminCaseDto, AdminCompanyDetailDto, AdminConnectionGroupDto, AdminReviewDto, AdminSearchDto } from "@capitalforge/shared";
import { AdminCaseReq, AdminCloseReq, AdminEnforceReq, AdminNoteReq, AdminResetPasswordReq } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useCat } from "@/lib/catalog";
import { useData, useList } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { Async, Badge, Button, Card, EmptyState, KV, Notice, SelectField, Sheet, SkeletonList, SystemBadge, TextField, Trend } from "@/ui";

function Reasoning({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  return <TextField label={t("admin.reasoning")} value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} hint={t("admin.reasoningHint")} />;
}

function OpenCase({ open, onClose, subjectType, subjectId, defaultTitle, goCases }: { open: boolean; onClose: () => void; subjectType: "account" | "company" | "connection_group" | "transaction" | "alert"; subjectId: string; defaultTitle: string; goCases: () => void }) {
  const { t } = useT();
  const { run, busy } = useAction();
  const [title, setTitle] = useState(defaultTitle);
  const [why, setWhy] = useState("");
  const body = { subjectType, subjectId, title, reasoning: why };
  return (
    <Sheet open={open} onClose={onClose} closeLabel={t("common.close")} title={t("admin.openCase")}>
      <div className="col">
        <TextField label={t("admin.caseTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <Reasoning value={why} onChange={setWhy} />
        <Button variant="primary" loading={busy} disabled={!AdminCaseReq.omit({ idempotencyKey: true }).safeParse(body).success} onClick={() => void run(() => api.post("/admin/cases", body), { ok: "admin.caseOpened" }).then((r) => { if (r) { onClose(); goCases(); } })}>{t("admin.openCase")}</Button>
      </div>
    </Sheet>
  );
}

export function SearchTab({ goCases }: { goCases: () => void }) {
  const i = useT();
  const { t } = i;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const res = useData<AdminSearchDto>(q.trim().length >= 1 ? "/admin/search" : null, { q: q.trim() }, []);
  return (
    <div className="col">
      <TextField label={t("admin.search")} value={q} onChange={(e) => setQ(e.target.value)} hint={t("admin.searchHint")} />
      {res.data ? (
        <div className="col">
          <h4>{t("admin.companies")}</h4>
          {res.data.companies.length ? res.data.companies.map((c) => (
            <Card key={c.id} tight onClick={() => setSel(c.id)}><div className="row between wrap"><b>{c.name} {c.isSystem ? <SystemBadge /> : null}{c.dissolved ? <Badge tone="bad">{t("admin.dissolved")}</Badge> : null}</b><span className="small muted">{c.username ?? "—"} · {t("common.level")} {c.level}</span></div></Card>
          )) : <p className="muted small">{t("common.none")}</p>}
          <h4>{t("admin.accounts")}</h4>
          {res.data.accounts.length ? res.data.accounts.map((a) => (
            <Card key={a.id} tight onClick={a.companyId ? () => setSel(a.companyId) : undefined}><div className="row between wrap"><b>{a.username}</b><span className="row">{a.role === "admin" ? <Badge tone="forge">admin</Badge> : null}{a.frozen ? <Badge tone="bad">{t("admin.frozen")}</Badge> : null}<span className="small muted">{a.companyName ?? t("admin.noCompany")}</span></span></div></Card>
          )) : <p className="muted small">{t("common.none")}</p>}
        </div>
      ) : res.loading && q ? <SkeletonList n={2} h={48} /> : <EmptyState icon="shield" title={t("admin.searchEmpty")} />}
      <CompanySheet id={sel} onClose={() => setSel(null)} goCases={goCases} />
    </div>
  );
}

function CompanySheet({ id, onClose, goCases }: { id: string | null; onClose: () => void; goCases: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const res = useData<AdminCompanyDetailDto>(id ? `/admin/companies/${id}` : null, undefined, []);
  const [caseOpen, setCaseOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [why, setWhy] = useState("");
  const d = res.data;
  const pwBody = d?.account ? { accountId: d.account.id, newPassword: pw, reasoning: why } : null;
  return (
    <Sheet open={!!id} onClose={onClose} wide closeLabel={t("common.close")} title={d?.company.name ?? t("admin.companyDetail")}>
      <Async res={res} skeleton={<SkeletonList n={3} />}>
        {(c) => (
          <div className="col">
            <KV k={t("found.sector")} v={`${t(`sector.${c.company.sector}`)} · ${cat.city(c.company.homeCityId)}`} />
            <KV k={t("common.level")} v={`${c.company.level} (XP ${i.num(c.company.xp)})`} />
            <KV k={t("company.reputation")} v={`${c.company.onTimeDeliveries} / ${c.company.onTimeDeliveries + c.company.lateOrMissed}`} />
            {c.account ? <KV k={t("auth.username")} v={<>{c.account.username} {c.account.frozen ? <Badge tone="bad">{t("admin.frozen")}</Badge> : null}</>} /> : null}
            <h4>{t("finance.balances")}</h4>
            {Object.entries(c.balances).map(([k, v]) => <KV key={k} k={i.has(`accounts.${k}`) ? t(`accounts.${k}`) : k} v={i.money(v)} />)}
            <h4>{t("admin.counts")}</h4>
            <KV k={t("admin.openListings")} v={c.counts.openListings} /><KV k={t("admin.openOrders")} v={c.counts.openOrders} /><KV k={t("admin.activeContracts")} v={c.counts.activeContracts} /><KV k={t("admin.openFreight")} v={c.counts.openFreightJobs} /><KV k={t("logistics.fleet")} v={c.counts.vehicles} />
            <h4>{t("panels.facilities")}</h4>
            {c.facilities.map((f) => <KV key={f.id} k={`${cat.building(f.type)} · ${cat.city(f.cityId)} · ${t("common.level")} ${f.level}`} v={`${f.state} · ${f.runningJobs}`} />)}
            <h4>{t("panels.inventory")}</h4>
            {c.holdings.map((h, n) => <KV key={n} k={`${cat.product(h.productId)} ★${h.quality} · ${cat.city(h.cityId)}`} v={`${i.qty(h.qtyKg)} · ${i.price(h.avgCostPerKg)}`} />)}
            <h4>{t("finance.sales")}</h4>
            {c.sales.slice(0, 15).map((s) => <KV key={s.id} k={`${i.date(s.at)} · ${cat.product(s.productId)} ${i.qty(s.qtyKg)}`} v={<Trend value={s.netProfit} text={i.signed(s.netProfit)} />} />)}
            <h4>{t("finance.ledger")}</h4>
            {c.ledger.slice(0, 20).map((l, n) => <KV key={n} k={`${l.kind} · ${l.account}`} v={i.signed(l.amount)} />)}
            <div className="row wrap"><Button variant="primary" onClick={() => setCaseOpen(true)}>{t("admin.openCase")}</Button></div>
            {c.account && c.account.role !== "admin" ? (
              <Card flat><div className="col">
                <h4>{t("admin.resetPassword")}</h4>
                <TextField label={t("account.newPassword")} type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
                <Reasoning value={why} onChange={setWhy} />
                <Button variant="danger" loading={busy} disabled={!pwBody || !AdminResetPasswordReq.omit({ idempotencyKey: true }).safeParse(pwBody).success} onClick={() => void run(() => api.post(`/admin/accounts/${c.account!.id}/reset-password`, pwBody!), { ok: "admin.passwordReset" }).then((r) => { if (r) { setPw(""); setWhy(""); } })}>{t("admin.resetPassword")}</Button>
              </div></Card>
            ) : null}
            <OpenCase open={caseOpen} onClose={() => setCaseOpen(false)} subjectType="company" subjectId={c.company.id} defaultTitle={c.company.name} goCases={() => { onClose(); goCases(); }} />
          </div>
        )}
      </Async>
    </Sheet>
  );
}

export function Connections({ goCases }: { goCases: () => void }) {
  const i = useT();
  const { t } = i;
  const { me } = useApp();
  const allowed = !!me?.account?.canReviewConnections;
  const res = useList<AdminConnectionGroupDto>(allowed ? "/admin/connections" : null, undefined, []);
  const [sel, setSel] = useState<AdminConnectionGroupDto | null>(null);
  if (!allowed) return <Notice tone="warn">{t("admin.noConnectionAccess")}</Notice>;
  return (
    <div className="col">
      <Notice tone="steel">{t("admin.connectionsNote")}</Notice>
      <Async res={res}>
        {(rows) => !rows.length ? <EmptyState icon="shield" title={t("admin.noGroups")} text={t("admin.noGroupsText")} /> : (
          <div className="col">{rows.map((g) => (
            <Card key={g.groupId} onClick={() => setSel(g)}><div className="col tight">
              <div className="row between wrap"><b>{g.label}</b><span className="row">{g.flaggedTrades ? <Badge tone="bad">⚑ {g.flaggedTrades}</Badge> : null}<Badge>{t("admin.interactions", { n: g.interactions })}</Badge></span></div>
              <span className="small muted2">{g.accounts.map((a) => `${a.username}${a.companyName ? ` (${a.companyName})` : ""}`).join(", ")}</span>
              <span className="xs muted">{t("admin.lastSeen")}: {i.date(g.lastSeenAt)}</span>
            </div></Card>
          ))}</div>
        )}
      </Async>
      {sel ? <ReviewSheet g={sel} onClose={() => setSel(null)} goCases={goCases} /> : null}
    </div>
  );
}

function ReviewSheet({ g, onClose, goCases }: { g: AdminConnectionGroupDto; onClose: () => void; goCases: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const res = useData<AdminReviewDto>(`/admin/connections/${g.groupId}`, undefined, []);
  const [caseOpen, setCaseOpen] = useState(false);
  return (
    <Sheet open onClose={onClose} wide closeLabel={t("common.close")} title={g.label}>
      <Async res={res} skeleton={<SkeletonList n={3} />}>
        {(d) => (
          <div className="col">
            <KV k={t("admin.valueTransferred")} v={<b>{i.money(d.totals.valueTransferred)}</b>} />
            {d.totals.byDirection.map((x, n) => <KV key={n} k={`${x.from} → ${x.to}`} v={i.money(x.value)} />)}
            <h4>{t("admin.interactionsTitle")}</h4>
            {d.trades.map((x, n) => (
              <div key={n} className="card flat tight col tight">
                <div className="row between wrap"><b className="small">{x.kind} · {x.from} → {x.to}</b><span className="xs muted">{i.date(x.at)}</span></div>
                <span className="small">{x.productId ? cat.product(x.productId) : ""} {x.qtyKg ? i.qty(x.qtyKg) : ""} {x.pricePerKg ? `· ${i.price(x.pricePerKg)}` : ""} · <b>{i.money(x.value)}</b></span>
                {x.anomaly ? <span className={`small ${x.anomaly.insufficientData ? "muted" : "bad"}`}>{x.anomaly.insufficientData ? `${t("admin.insufficient")} · ` : "⚑ "}{t("admin.refPrice")}: {i.price(x.anomaly.refPricePerKg)} · {t("admin.deviation")}: {x.anomaly.deviationBp > 0 ? "▲ +" : "▼ "}{i.pct(x.anomaly.deviationBp)} · {t("admin.comparables")}: {x.anomaly.comparables}</span> : null}
              </div>
            ))}
            <Button variant="primary" onClick={() => setCaseOpen(true)}>{t("admin.openCase")}</Button>
            <OpenCase open={caseOpen} onClose={() => setCaseOpen(false)} subjectType="connection_group" subjectId={g.groupId} defaultTitle={g.label} goCases={() => { onClose(); goCases(); }} />
          </div>
        )}
      </Async>
    </Sheet>
  );
}

export function Cases() {
  const i = useT();
  const { t } = i;
  const [status, setStatus] = useState("open");
  const res = useList<AdminCaseDto>("/admin/cases", { status }, ["*"]);
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="col">
      <SelectField label={t("common.status")} value={status} onChange={setStatus} options={[{ id: "", label: t("common.all") }, { id: "open", label: t("admin.caseOpen") }, { id: "closed", label: t("admin.caseClosed") }]} />
      <Async res={res}>
        {(rows) => !rows.length ? <EmptyState icon="doc" title={t("admin.noCases")} text={t("admin.noCasesText")} /> : (
          <div className="col">{rows.map((c) => (
            <Card key={c.id} onClick={() => setSel(c.id)}><div className="row between wrap"><b>{c.title}</b><span className="row"><Badge>{c.subjectType}</Badge><Badge tone={c.status === "open" ? "warn" : "good"}>{c.status === "open" ? t("admin.caseOpen") : t("admin.caseClosed")}</Badge></span></div><span className="xs muted">{c.openedBy} · {i.date(c.openedAt)}</span></Card>
          ))}</div>
        )}
      </Async>
      {sel ? <CaseSheet c={res.data?.find((x) => x.id === sel) ?? null} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

const ACTIONS = ["freeze_account", "unfreeze_account", "reverse_transaction", "cancel_listing", "cancel_contract"] as const;

function CaseSheet({ c, onClose }: { c: AdminCaseDto | null; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const { run, busy } = useAction();
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<"no_action" | "warning" | "enforced">("no_action");
  const [why, setWhy] = useState("");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("freeze_account");
  const [target, setTarget] = useState("");
  const [ewhy, setEwhy] = useState("");
  if (!c) return null;
  const closeBody = { resolution, reasoning: why };
  const enfBody = { action, targetId: target, reasoning: ewhy };
  return (
    <Sheet open onClose={onClose} wide closeLabel={t("common.close")} title={c.title}>
      <div className="col">
        <KV k={t("admin.subject")} v={`${c.subjectType} · ${c.subjectId.slice(0, 12)}`} />
        {c.resolution ? <KV k={t("admin.resolution")} v={t(`admin.resolutions.${c.resolution}`)} /> : null}
        <h4>{t("admin.timeline")}</h4>
        {c.events.map((e, n) => <div key={n} className="card flat tight col tight"><div className="row between"><b className="small">{t(`admin.eventKind.${e.kind}`)}{e.action ? ` · ${e.action}` : ""}</b><span className="xs muted">{e.by} · {i.date(e.at)}</span></div><span className="small">{e.text}</span></div>)}
        {c.status === "open" ? (
          <>
            <TextField label={t("admin.note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            <Button loading={busy} disabled={!AdminNoteReq.omit({ idempotencyKey: true }).safeParse({ text: note }).success} onClick={() => void run(() => api.post(`/admin/cases/${c.id}/notes`, { text: note }), { ok: "admin.noteAdded" }).then((r) => { if (r) setNote(""); })}>{t("admin.addNote")}</Button>
            <Card flat><div className="col">
              <h4>{t("admin.enforce")}</h4>
              <Notice tone="warn">{t("admin.enforceWarn")}</Notice>
              <SelectField label={t("admin.action")} value={action} onChange={(v) => setAction(v as (typeof ACTIONS)[number])} options={ACTIONS.map((a) => ({ id: a, label: t(`admin.actions.${a}`) }))} />
              <TextField label={t("admin.targetId")} value={target} onChange={(e) => setTarget(e.target.value)} hint={t(`admin.targetHint.${action}`)} autoComplete="off" />
              <Reasoning value={ewhy} onChange={setEwhy} />
              <Button variant="danger" loading={busy} disabled={!AdminEnforceReq.omit({ idempotencyKey: true }).safeParse(enfBody).success} onClick={() => { if (window.confirm(t("admin.enforceConfirm"))) void run(() => api.post(`/admin/cases/${c.id}/enforce`, enfBody), { ok: "admin.enforced" }); }}>{t("admin.enforce")}</Button>
            </div></Card>
            <Card flat><div className="col">
              <h4>{t("admin.closeCase")}</h4>
              <SelectField label={t("admin.resolution")} value={resolution} onChange={(v) => setResolution(v as typeof resolution)} options={(["no_action", "warning", "enforced"] as const).map((r) => ({ id: r, label: t(`admin.resolutions.${r}`) }))} />
              <Reasoning value={why} onChange={setWhy} />
              <Button loading={busy} disabled={!AdminCloseReq.omit({ idempotencyKey: true }).safeParse(closeBody).success} onClick={() => void run(() => api.post(`/admin/cases/${c.id}/close`, closeBody), { ok: "admin.caseClosedToast" }).then((r) => { if (r) onClose(); })}>{t("admin.closeCase")}</Button>
            </div></Card>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
