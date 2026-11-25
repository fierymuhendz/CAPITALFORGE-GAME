"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/lib/app";

export default function Home() {
  const { me } = useApp();
  const r = useRouter();
  useEffect(() => {
    if (!me?.account) r.replace("/login");
    else if (!me.company) r.replace(me.account.role === "admin" ? "/admin" : "/found");
    else r.replace("/play");
  }, [me, r]);
  return <main className="page" aria-busy="true"><div className="auth-card"><div className="skel" style={{ height: 120 }} /></div></main>;
}
