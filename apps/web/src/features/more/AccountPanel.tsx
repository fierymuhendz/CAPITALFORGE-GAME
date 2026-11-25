"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChangePasswordReq } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { Button, Card, KV, Notice, Seg, TextField } from "@/ui";
import { AdminSetup } from "./AdminSetup";

export function AccountPanel() {
  const i = useT();
  const { t } = i;
  const { me, setLocale, theme, setTheme, refreshMe, signedOut } = useApp();
  const { run, busy } = useAction();
  const router = useRouter();
  const [oldP, setOld] = useState("");
  const [newP, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const a = me?.account;
  if (!a) return null;
  const pwOk = ChangePasswordReq.safeParse({ oldPassword: oldP, newPassword: newP }).success;
  const company = me?.company;
  return (
    <div className="col">
      <Card><div className="col">
        <KV k={t("auth.username")} v={a.username} />
        <div className="field"><span className="lbl">{t("account.language")}</span>
          <Seg label={t("account.language")} value={i.locale} onChange={(l) => void setLocale(l)} items={[{ id: "tr", label: "Türkçe" }, { id: "en", label: "English" }]} /></div>
        <div className="field"><span className="lbl">{t("account.theme")}</span>
          <Seg label={t("account.theme")} value={theme} onChange={setTheme} items={[{ id: "dark", label: t("account.themeDark") }, { id: "light", label: t("account.themeLight") }]} /></div>
        <div className="field"><span className="lbl">{t("account.graphics")}</span>
          <Seg label={t("account.graphics")} value={a.graphics} onChange={(g) => void run(() => api.patch("/account/prefs", { graphics: g })).then(() => refreshMe())} items={(["auto", "high", "low", "lite"] as const).map((g) => ({ id: g, label: t(`account.gfx.${g}`) }))} />
          <span className="hint">{t("account.graphicsHint")}</span></div>
      </div></Card>

      <Card><form className="col" onSubmit={(e) => { e.preventDefault(); void run(() => api.post("/account/password", { oldPassword: oldP, newPassword: newP }), { ok: "account.passwordChanged" }).then((r) => { if (r) { setOld(""); setNew(""); } }); }}>
        <h4>{t("account.password")}</h4>
        <TextField label={t("account.oldPassword")} type="password" autoComplete="current-password" value={oldP} onChange={(e) => setOld(e.target.value)} />
        <TextField label={t("account.newPassword")} type="password" autoComplete="new-password" value={newP} onChange={(e) => setNew(e.target.value)} hint={t("auth.passwordHint")} />
        <Button type="submit" loading={busy} disabled={!pwOk}>{t("account.changePassword")}</Button>
      </form></Card>

      <AdminSetup />

      <Button onClick={() => void run(() => api.post("/auth/logout")).then(() => { signedOut(); router.replace("/login"); })}>{t("account.logout")}</Button>

      {company ? (
        <Card><div className="col">
          <h4 className="bad">{t("account.dissolve")}</h4>
          <Notice tone="warn">{t("account.dissolveWarn")}</Notice>
          <TextField label={t("account.dissolveConfirm", { name: company.name })} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          <Button variant="danger" loading={busy} disabled={confirm.trim().toLowerCase() !== company.name.toLowerCase()} onClick={() => void run(() => api.post("/account/dissolve", { confirmName: confirm }), { ok: "account.dissolved" }).then((r) => { if (r) { refreshMe(); router.replace("/found"); } })}>{t("account.dissolveBtn")}</Button>
        </div></Card>
      ) : null}
    </div>
  );
}
