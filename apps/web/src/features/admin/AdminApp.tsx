"use client";
import Link from "next/link";
import { useState } from "react";
import { TotpCodeReq } from "@capitalforge/shared";
import { api } from "@/lib/api";
import { useAction } from "@/lib/action";
import { useApp } from "@/lib/app";
import { useGate } from "@/lib/gate";
import { useT } from "@/lib/i18n";
import { Button, Card, EmptyState, Tabs, TextField } from "@/ui";
import { Brand, LangSwitch, ThemeToggle } from "../common/Chrome";
import { AdminSetup } from "../more/AdminSetup";
import { Alerts, Overview } from "./AdminOverview";
import { Cases, Connections, SearchTab } from "./AdminPeople";
import { AuditTab, CatalogTab, TimeTab } from "./AdminCatalog";

export function AdminApp() {
  const ok = useGate("account");
  const { t } = useT();
  const { me, refreshMe } = useApp();
  const { run, busy } = useAction();
  const [tab, setTab] = useState("overview");
  const [code, setCode] = useState("");
  const a = me?.account;
  if (!ok || !a) return null;
  const top = <div className="topbar" style={{ maxWidth: 1200 }}><Brand /><span className="grow" />{me?.company ? <Link className="btn ghost sm" href="/play">← {t("admin.backToGame")}</Link> : null}<ThemeToggle /><LangSwitch /></div>;
  if (a.role !== "admin" || !a.totpEnabled) {
    return <main className="page">{top}<div className="auth-card col"><h2>{t("admin.title")}</h2><p className="muted2">{a.role === "admin" ? t("admin.needTotp") : t("admin.needClaim")}</p><AdminSetup /></div></main>;
  }
  if (!a.adminVerified) {
    return (
      <main className="page">{top}
        <form className="auth-card col" onSubmit={(e) => { e.preventDefault(); void run(() => api.post("/auth/totp/verify", { code })).then((r) => { if (r) { setCode(""); refreshMe(); } }); }}>
          <h2>{t("admin.verifyTitle")}</h2><p className="muted2">{t("admin.verifyHint")}</p>
          <Card><div className="col"><TextField label={t("adminSetup.code")} inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!TotpCodeReq.safeParse({ code }).success}>{t("admin.verify")}</Button></div></Card>
        </form>
      </main>
    );
  }
  return (
    <main className="page">{top}
      <div className="page-inner" style={{ width: "min(1200px, 100%)" }}>
        <h1>{t("admin.title")}</h1>
        <Tabs label={t("admin.title")} value={tab} onChange={setTab} items={["overview", "alerts", "search", "connections", "cases", "catalog", "audit", "time"].map((id) => ({ id, label: t(`admin.tabs.${id}`) }))} />
        {tab === "overview" ? <Overview /> : tab === "alerts" ? <Alerts goCases={() => setTab("cases")} /> : tab === "search" ? <SearchTab goCases={() => setTab("cases")} /> : tab === "connections" ? <Connections goCases={() => setTab("cases")} />
          : tab === "cases" ? <Cases /> : tab === "catalog" ? <CatalogTab /> : tab === "audit" ? <AuditTab /> : tab === "time" ? <TimeTab /> : <EmptyState title="?" />}
      </div>
    </main>
  );
}
