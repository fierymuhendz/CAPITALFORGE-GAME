"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/api";

/** Beklenmeyen çizim hatası: sunucuya bildir, kullanıcıya tekrar dene seçeneği sun (iki dilli, bağlama bağımlı değil). */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { reportClientError(error.message, error.stack); }, [error]);
  const tr = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("tr");
  return (
    <main className="page"><div className="auth-card card col">
      <h2>{tr ? "Bir şeyler ters gitti" : "Something went wrong"}</h2>
      <p className="muted2">{tr ? "Hata kaydedildi. Tekrar deneyebilirsiniz." : "The error was logged. You can try again."}</p>
      <button type="button" className="btn primary" onClick={reset}>{tr ? "Tekrar dene" : "Try again"}</button>
    </div></main>
  );
}
