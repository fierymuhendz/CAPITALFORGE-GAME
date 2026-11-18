"use client";

import { useState, type FormEvent } from "react";
import { GuestLoginResponseSchema, UsernameSchema } from "@capitalforge/shared";
import { saveSession, type StoredSession } from "../lib/session";

const ERRORS: Record<string, string> = {
  USERNAME_TAKEN: "Bu kullanıcı adı alınmış, başka bir ad seçin.",
  RATE_LIMITED: "Çok fazla deneme. Bir dakika sonra tekrar deneyin.",
  INVALID: "Kullanıcı adı 3-20 karakter olmalı (harf, rakam, alt çizgi).",
};

export function LoginForm({ onLogin, notice }: { onLogin: (s: StoredSession) => void; notice?: string }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!UsernameSchema.safeParse(username).success) {
      setError(ERRORS.INVALID!);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body as { error?: string } | null)?.error ?? "";
        setError(ERRORS[code] ?? "Giriş yapılamadı. Tekrar deneyin.");
        return;
      }
      const parsed = GuestLoginResponseSchema.parse(body);
      const session = { token: parsed.token, username: parsed.username };
      saveSession(session);
      onLogin(session);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">CapitalForge</h1>
      <p className="text-slate-400">Bir kullanıcı adı seçin ve piyasaya girin.</p>
      {notice && <p role="alert" className="rounded bg-amber-900 p-2 text-sm text-amber-200">{notice}</p>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="username" className="text-sm">Kullanıcı adı</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          className="rounded bg-slate-800 p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        />
        {error && <p role="alert" className="text-sm text-red-400">⚠ {error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600 p-3 font-semibold hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
        >
          {busy ? "Giriliyor…" : "Oyuna gir"}
        </button>
      </form>
    </main>
  );
}
