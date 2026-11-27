"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LoginReq, RegisterReq } from "@capitalforge/shared";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { Button, Notice, TextField } from "@/ui";
import { LangSwitch, ThemeToggle } from "../common/Chrome";
import "./entry.css";

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const { t, locale, err } = useT();
  const { me, refreshMe } = useApp();
  const router = useRouter();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [invite, setInvite] = useState("");
  const [needInvite, setNeedInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (me?.account) router.replace("/"); }, [me, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = mode === "login" ? LoginReq.safeParse({ username, password }) : RegisterReq.safeParse({ username, password, locale });
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      setError(path === "password" ? t("errors.WEAK_PASSWORD") : t("auth.badUsername"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ needsTotp?: boolean }>(mode === "login" ? "/auth/login" : "/auth/register", parsed.data, invite ? { "x-cf-registration-code": invite } : undefined);
      void res;
      refreshMe();
    } catch (x) {
      if (x instanceof ApiError && x.code === "FORBIDDEN" && mode === "register") setNeedInvite(true);
      setError(err(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-screen auth-entry">
      <div className="entry-landscape">
        <div className="entry-signature">
          <div className="entry-wordmark">Capital <span>Forge</span></div>
          <p>{t("auth.tagline")}</p>
        </div>
      </div>
      <div className="entry-desk">
        <div className="entry-settings"><ThemeToggle /><LangSwitch /></div>
        <section className="entry-form" aria-labelledby="entry-title">
          <h1 id="entry-title">{mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}</h1>
          <form className="col" onSubmit={submit} noValidate>
            <TextField label={t("auth.username")} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} hint={mode === "register" ? t("auth.usernameHint") : undefined} />
            <TextField label={t("auth.password")} type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={128} hint={mode === "register" ? t("auth.passwordHint") : undefined} />
            {needInvite ? <TextField label={t("auth.invite")} value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" /> : null}
            {error ? <Notice tone="bad">{error}</Notice> : null}
            <Button type="submit" variant="primary" size="lg" loading={busy}>{mode === "login" ? t("auth.login") : t("auth.register")}</Button>
          </form>
          <p className="entry-switch">
            {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
            <Link href={mode === "login" ? "/register" : "/login"}>{mode === "login" ? t("auth.register") : t("auth.login")}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
