"use client";
import { useMemo, useState } from "react";
import type { AdminBalanceResultDto, AdminCatalogDto, AdminPlayerDetailDto, AdminPlayersDto } from "@capitalforge/shared";
import { AdminBalanceReq, AdminPlayerStatusReq } from "@capitalforge/shared";
import { api, newKey } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useCat } from "@/lib/catalog";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { parseLira } from "@/lib/numbers";
import { Async, Badge, Button, Card, EmptyState, KV, Notice, SelectField, Sheet, SkeletonList, TextField } from "@/ui";

type Mode = "add" | "deduct" | "set";

/** Oyuncu Yönetimi: arama, şirket + nakit, askıya alma, bakiye ayarı. Tüm hesaplar sunucuda. */
export function PlayersTab() {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const res = useData<AdminPlayersDto>("/admin/players", { q: q.trim() }, ["*"]);
  return (
    <div className="col">
      <PlaytestCard />
      <TextField label={t("admin.players.search")} value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} hint={t("admin.players.searchHint")} />
      <Async res={res} skeleton={<SkeletonList n={3} h={56} />}>
        {(d) => !d.rows.length ? <EmptyState icon="shield" title={t("admin.players.empty")} /> : (
          <div className="col">{d.rows.map((p) => (
            <Card key={p.accountId} tight onClick={() => setSel(p.accountId)}>
              <div className="row between wrap">
                <span className="col tight">
                  <b>{p.username} {p.role === "admin" ? <Badge tone="forge">admin</Badge> : null} {p.suspended ? <Badge tone="bad">{t("admin.players.suspended")}</Badge> : null}</b>
                  <span className="small muted2">{p.company ? `${p.company.name} · ${t(`sector.${p.company.sector}`)} · ${cat.city(p.company.homeCityId)}` : t("admin.players.noCompany")}</span>
                </span>
                <b className="num">{p.cash !== null ? i.money(p.cash) : "—"}</b>
              </div>
            </Card>
          ))}</div>
        )}
      </Async>
      {sel ? <PlayerSheet accountId={sel} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

function PlayerSheet({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const i = useT();
  const { t } = i;
  const cat = useCat();
  const { run, busy } = useAction();
  const res = useData<AdminPlayerDetailDto>(`/admin/players/${accountId}`, undefined, ["*"]);
  const [why, setWhy] = useState("");
  const [mode, setMode] = useState<Mode>("add");
  const [amountText, setAmountText] = useState("");
  const [bwhy, setBwhy] = useState("");
  // bir form doldurma = bir istek anahtarı: çift tıklama veya yeniden deneme aynı ayarı ikinci kez uygulamaz
  const [key, setKey] = useState(() => newKey());
  const d = res.data;
  const amount = parseLira(amountText);
  const balBody = { mode, amount: amount ?? -1, reason: bwhy, idempotencyKey: key };
  const balOk = AdminBalanceReq.safeParse(balBody).success;
  const before = d?.player.cash !== null && d?.player.cash !== undefined ? BigInt(d.player.cash) : null;
  // yalnızca önizleme; asıl hesap sunucuda
  const after = useMemo(() => {
    if (before === null || amount === null) return null;
    const a = BigInt(amount);
    return mode === "add" ? before + a : mode === "deduct" ? before - a : a;
  }, [before, amount, mode]);
  const statusBody = d ? { suspended: !d.player.suspended, reason: why } : null;
  return (
    <Sheet open onClose={onClose} wide closeLabel={t("common.close")} title={d?.player.username ?? t("admin.players.title")}>
      <Async res={res} skeleton={<SkeletonList n={3} />}>
        {(p) => (
          <div className="col">
            <KV k={t("admin.players.company")} v={p.player.company ? `${p.player.company.name} · ${t(`sector.${p.player.company.sector}`)} · ${cat.city(p.player.company.homeCityId)} · ${t("common.level")} ${p.player.company.level}` : t("admin.players.noCompany")} />
            <KV k={t("admin.players.cash")} v={<b className="num">{p.player.cash !== null ? i.money(p.player.cash) : "—"}</b>} />
            <KV k={t("admin.players.status")} v={p.player.suspended ? <Badge tone="bad">{t("admin.players.suspended")}</Badge> : <Badge tone="good">{t("admin.players.active")}</Badge>} />
            {p.suspendedAt ? <KV k={t("admin.players.suspendedSince")} v={i.date(p.suspendedAt)} /> : null}
            <KV k={t("admin.players.lastLogin")} v={p.player.lastLoginAt ? i.date(p.player.lastLoginAt) : "—"} />

            {p.player.role !== "admin" ? (
              <Card flat><div className="col">
                <h4>{t("admin.players.status")}</h4>
                <p className="small muted2">{t("admin.players.suspendHint")}</p>
                <TextField label={t("admin.players.reason")} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} hint={t("admin.players.reasonHint")} />
                <Button
                  variant={p.player.suspended ? "primary" : "danger"} loading={busy}
                  disabled={!statusBody || !AdminPlayerStatusReq.omit({ idempotencyKey: true }).safeParse(statusBody).success}
                  onClick={() => void run(() => api.post(`/admin/players/${accountId}/status`, { suspended: !p.player.suspended, reason: why }), { ok: p.player.suspended ? "admin.players.reactivatedOk" : "admin.players.suspendedOk" }).then((r) => { if (r) { setWhy(""); res.reload(); } })}
                >{p.player.suspended ? t("admin.players.reactivate") : t("admin.players.suspend")}</Button>
              </div></Card>
            ) : null}

            {p.player.company ? (
              <Card flat><div className="col">
                <h4>{t("admin.players.balance")}</h4>
                <p className="small muted2">{t("admin.players.balanceHint")}</p>
                <SelectField label={t("admin.players.mode")} value={mode} onChange={(v) => setMode(v as Mode)} options={(["add", "deduct", "set"] as const).map((x) => ({ id: x, label: t(`admin.players.modes.${x}`) }))} />
                <TextField label={mode === "set" ? t("admin.players.amountSet") : t("admin.players.amount")} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} hint={t("admin.players.amountHint")} autoComplete="off" />
                {before !== null && after !== null ? <span className={`small ${after < 0n ? "bad" : "muted2"}`}>{t("admin.players.preview", { before: i.money(before), after: i.money(after) })}</span> : null}
                <TextField label={t("admin.players.reason")} value={bwhy} onChange={(e) => setBwhy(e.target.value)} maxLength={500} hint={t("admin.players.reasonHint")} />
                <Button
                  variant="primary" loading={busy} disabled={!balOk || (after !== null && after < 0n)}
                  onClick={() => {
                    if (after !== null && before !== null && !window.confirm(t("admin.players.confirm", { company: p.player.company!.name, before: i.money(before), after: i.money(after) }))) return;
                    void run(() => api.post<AdminBalanceResultDto>(`/admin/players/${accountId}/balance`, balBody), { ok: "admin.players.adjustedOk" }).then((r) => {
                      if (r) { setAmountText(""); setBwhy(""); setKey(newKey()); res.reload(); }
                    });
                  }}
                >{t("admin.players.apply")}</Button>
              </div></Card>
            ) : null}

            <h4>{t("admin.players.history")}</h4>
            {p.adjustments.length ? p.adjustments.map((a) => (
              <div key={a.id} className="card flat tight col tight">
                <div className="row between wrap"><b className="small">{t(`admin.players.modes.${a.mode}`)} · {i.signed(a.delta)}</b><span className="xs muted">{a.adminUsername} · {i.date(a.at)}</span></div>
                <span className="small num">{i.money(a.before)} → {i.money(a.after)}</span>
                <span className="small">{a.reason}</span>
                {a.transactionId ? <span className="xs muted">{t("admin.players.ledgerTx")}: {a.transactionId.slice(0, 8)}</span> : null}
              </div>
            )) : <p className="muted small">{t("admin.players.noHistory")}</p>}

            {p.statusHistory.length ? (
              <>
                <h4>{t("admin.players.statusHistory")}</h4>
                {p.statusHistory.map((s, n) => (
                  <div key={n} className="card flat tight col tight">
                    <div className="row between wrap"><b className="small">{s.suspended ? t("admin.players.suspend") : t("admin.players.reactivate")}</b><span className="xs muted">{s.adminUsername} · {i.date(s.at)}</span></div>
                    <span className="small">{s.reason}</span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        )}
      </Async>
    </Sheet>
  );
}

/** Oyun testi kipi anahtarı: settings.pace.playtestSeconds (60 = açık, 0 = normal tempo) */
export function PlaytestCard() {
  const { t } = useT();
  const { run, busy } = useAction();
  const res = useData<AdminCatalogDto>("/admin/catalog", undefined, ["*"]);
  const [why, setWhy] = useState("");
  const pace = res.data?.settings.pace?.value as { playtestSeconds?: number } | undefined;
  const sec = pace?.playtestSeconds ?? 0;
  const on = sec > 0;
  const set = (value: number) =>
    void run(() => api.patch("/admin/settings", { key: "pace.playtestSeconds", value, reasoning: why }), { ok: "admin.playtest.changed" }).then((r) => { if (r) { setWhy(""); res.reload(); } });
  return (
    <Card flat><div className="col">
      <div className="row between wrap"><h4>{t("admin.playtest.title")}</h4>{res.data ? <Badge tone={on ? "warn" : "good"}>{on ? `${sec} s` : "—"}</Badge> : null}</div>
      {res.data ? <Notice tone={on ? "warn" : "steel"}>{on ? t("admin.playtest.on", { n: sec }) : t("admin.playtest.off")}</Notice> : null}
      <p className="xs muted">{t("admin.playtest.note")}</p>
      <TextField label={t("admin.playtest.reason")} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} />
      <Button variant={on ? "danger" : "primary"} loading={busy} disabled={!res.data || why.trim().length < 3} onClick={() => set(on ? 0 : 60)}>{on ? t("admin.playtest.disable") : t("admin.playtest.enable")}</Button>
    </div></Card>
  );
}
