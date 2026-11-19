"use client";

import { useEffect, useRef } from "react";
import { createChart, LineSeries, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { formatMoney } from "@capitalforge/economy";
import { HistoryResponseSchema } from "@capitalforge/shared";
import { useGame } from "./GameProvider";

/** Grafik değeri kuruş (tam sayı) olarak çizilir, eksen etiketi formatMoney'den geçer. */
export function PriceChart({ productId }: { productId: string }) {
  const { quotes, status, sessionExpired } = useGame();
  const box = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<"Line"> | null>(null);
  const lastTick = useRef<number | null>(null);
  const lastTime = useRef(0);

  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { timeVisible: true, secondsVisible: true },
      localization: { priceFormatter: (p: number) => formatMoney(BigInt(Math.round(p))) },
    });
    const s = chart.addSeries(LineSeries, {
      color: "#34d399",
      priceFormat: { type: "custom", minMove: 1, formatter: (p: number) => formatMoney(BigInt(Math.round(p))) },
    });
    series.current = s;
    return () => {
      series.current = null;
      chart.remove();
    };
  }, []);

  // Ürün değişince geçmişi yükle; yüklenene kadar canlı nokta eklenmez.
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    let cancelled = false;
    lastTick.current = null;
    s.setData([]);
    void (async () => {
      try {
        const res = await fetch(`/api/market/history?productId=${encodeURIComponent(productId)}`);
        if (res.status === 401) return sessionExpired();
        if (!res.ok) return;
        const { points } = HistoryResponseSchema.parse(await res.json());
        if (cancelled) return;
        let prev = 0;
        const data = points.map((p) => {
          const t = Math.max(Math.floor(Date.parse(p.at) / 1000), prev + 1);
          prev = t;
          return { time: t as UTCTimestamp, value: Number(p.price) };
        });
        s.setData(data);
        lastTime.current = prev;
        lastTick.current = points.length ? Math.max(...points.map((p) => p.tick)) : -1;
        const q = quotesRef.current[productId];
        if (q && q.tick > lastTick.current) append(q.tick, q.price);
      } catch {
        /* geçmiş yüklenemezse canlı veri yine de gelir */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  function append(tick: number, price: string) {
    const s = series.current;
    if (!s || lastTick.current === null || tick <= lastTick.current) return;
    lastTick.current = tick;
    lastTime.current = Math.max(Math.floor(Date.now() / 1000), lastTime.current + 1);
    s.update({ time: lastTime.current as UTCTimestamp, value: Number(price) });
  }

  const q = quotes[productId];
  useEffect(() => {
    if (q) append(q.tick, q.price);
  }, [q]);

  return (
    <section aria-label="Fiyat grafiği" className="rounded-lg bg-slate-900 p-4">
      <div ref={box} data-testid="price-chart" className="h-64 w-full" />
      {status !== "bağlı" && <p className="mt-2 text-xs text-amber-300">Canlı veri bekleniyor…</p>}
    </section>
  );
}
