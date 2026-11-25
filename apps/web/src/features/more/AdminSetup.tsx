"use client";
import { useState } from "react";
import { AdminClaimReq, TotpCodeReq } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { Button, Card, KV, Notice, TextField } from "@/ui";

/** Yönetici kurulumu: kurulum kodu → TOTP kurulumu (otpauth URL + gizli anahtar) → doğrulama kodu. */
export function AdminSetup() {
  const { t } = useT();
  const { me, refreshMe } = useApp();
  const { run, busy } = useAction();
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const a = me?.account;
  if (!a) return null;
  const claimOk = AdminClaimReq.safeParse({ setupCode: code }).success;
  const totpOk = TotpCodeReq.safeParse({ code: totp }).success;
  return (
    <Card><div className="col">
      <h4>{t("adminSetup.title")}</h4>
      {a.role !== "admin" ? (
        <>
          <p className="muted2 small">{t("adminSetup.claimHint")}</p>
          <TextField label={t("adminSetup.setupCode")} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button loading={busy} disabled={!claimOk} onClick={() => void run(() => api.post("/auth/admin/claim", { setupCode: code }), { ok: "adminSetup.claimed" }).then((r) => { if (r) { setCode(""); refreshMe(); } })}>{t("adminSetup.claim")}</Button>
        </>
      ) : !a.totpEnabled ? (
        <>
          <p className="muted2 small">{t("adminSetup.totpHint")}</p>
          {!secret ? <Button loading={busy} onClick={() => void run(() => api.post<{ secret: string; otpauthUrl: string }>("/auth/totp/setup")).then((r) => { if (r) setSecret(r); })}>{t("adminSetup.totpStart")}</Button> : (
            <>
              <Notice tone="warn">{t("adminSetup.secretWarn")}</Notice>
              <KV k={t("adminSetup.secret")} v={<code style={{ wordBreak: "break-all", userSelect: "all" }}>{secret.secret}</code>} />
              <KV k={t("adminSetup.url")} v={<code style={{ wordBreak: "break-all", userSelect: "all", fontSize: "var(--fs-xs)" }}>{secret.otpauthUrl}</code>} />
              <TextField label={t("adminSetup.code")} inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
              <Button variant="primary" loading={busy} disabled={!totpOk} onClick={() => void run(() => api.post("/auth/totp/enable", { code: totp }), { ok: "adminSetup.enabled" }).then((r) => { if (r) { setSecret(null); setTotp(""); refreshMe(); } })}>{t("adminSetup.enable")}</Button>
            </>
          )}
        </>
      ) : (
        <>
          <p className="good small">✓ {t("adminSetup.done")}</p>
          <Button href="/admin" variant="primary">{t("admin.title")}</Button>
        </>
      )}
    </div></Card>
  );
}
