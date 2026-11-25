"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./app";

/** Sayfa koruması: giriş yoksa /login, şirket yoksa /found, şirket varken /found → /play. */
export function useGate(need: "account" | "company" | "no-company" | "admin"): boolean {
  const { me } = useApp();
  const router = useRouter();
  const target =
    !me?.account ? "/login"
    : need === "admin" ? (me.account.role === "admin" ? null : "/play")
    : need === "company" && !me.company ? "/found"
    : need === "no-company" && me.company ? "/play"
    : null;
  useEffect(() => { if (target) router.replace(target); }, [target, router]);
  return !target;
}
