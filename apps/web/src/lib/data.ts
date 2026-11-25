"use client";
/**
 * Veri çekme kancası. Yol + sorgu parametreleri; ilgili konu için `invalidate` olayı gelince
 * (veya "*" ile her yenilemede) kısa bir gecikmeyle yeniden çeker. Eski veri ekranda kalır (titreme yok).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Topic } from "@capitalforge/shared";
import { api, ApiError } from "./api";
import { onInvalidate } from "./events";

const cache = new Map<string, unknown>();

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

type Params = Record<string, string | number | boolean | undefined | null>;
type TopicSpec = readonly (Topic | "*")[];

export function useData<T>(path: string | null, params?: Params, topics: TopicSpec = ["*"]): Resource<T> {
  const key = path ? path + JSON.stringify(params ?? {}) : null;
  const [data, setData] = useState<T | null>(key ? ((cache.get(key) as T | undefined) ?? null) : null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!key && !cache.has(key));
  const seq = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const topicsRef = useRef(topics);
  topicsRef.current = topics;

  const load = useCallback(async () => {
    if (!path || !key) return;
    const my = ++seq.current;
    try {
      const r = await api.get<T>(path, paramsRef.current);
      if (my !== seq.current) return;
      cache.set(key, r);
      setData(r);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof ApiError ? e : new ApiError("INTERNAL", 0));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    if (!key) { setData(null); setLoading(false); return; }
    const cached = cache.get(key) as T | undefined;
    setData(cached ?? null);
    setLoading(cached === undefined);
    setError(null);
    void load();
  }, [key, load]);

  useEffect(() => {
    if (!key) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onInvalidate((ev) => {
      const spec = topicsRef.current;
      const hit = ev === "*" ? spec.length > 0 : spec.includes("*") || ev.some((x) => (spec as readonly string[]).includes(x));
      if (!hit) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void load(), 200);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, [key, load]);

  const reload = useCallback(() => { void load(); }, [load]);
  return { data, error, loading, reload };
}

export function clearDataCache(): void { cache.clear(); }

/** İlgili konu yenilenince artan sayaç (POST ile hesaplanan teklif gibi özel çekimler için). */
export function useInvalidateTick(topics: TopicSpec = ["*"]): number {
  const [n, setN] = useState(0);
  const ref = useRef(topics);
  ref.current = topics;
  useEffect(() => onInvalidate((ev) => {
    const spec = ref.current;
    const hit = ev === "*" ? spec.length > 0 : spec.includes("*") || ev.some((x) => (spec as readonly string[]).includes(x));
    if (hit) setN((x) => x + 1);
  }), []);
  return n;
}

/** Liste uçları: dizi veya { items } dönebilir; her durumda dizi ver. */
export function useList<T>(path: string | null, params?: Params, topics: TopicSpec = ["*"]): Resource<T[]> {
  const r = useData<unknown>(path, params, topics);
  const data = r.data === null ? null : Array.isArray(r.data) ? (r.data as T[]) : Array.isArray((r.data as { items?: unknown }).items) ? ((r.data as { items: T[] }).items) : [];
  return { ...r, data };
}
