"use client";

import { useEffect, useState } from "react";
import { Client } from "colyseus.js";
import { formatMoney } from "@capitalforge/economy";
import { ROOMS } from "@capitalforge/shared";

type Status = "bağlanıyor" | "bağlı" | "koptu";

/** Fiyat sunucudan gelir; istemci hesap yapmaz, sadece gösterir. */
export function MarketTicker() {
  const [price, setPrice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("bağlanıyor");

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "ws://localhost:2567";
    const client = new Client(url);
    let leave: (() => void) | undefined;

    client
      .joinOrCreate(ROOMS.market)
      .then((room) => {
        setStatus("bağlı");
        room.onStateChange((state: { price: string }) => setPrice(state.price));
        room.onLeave(() => setStatus("koptu"));
        leave = () => void room.leave();
      })
      .catch(() => setStatus("koptu"));

    return () => leave?.();
  }, []);

  return (
    <section aria-live="polite">
      <p>Bağlantı: {status}</p>
      <p>Fiyat: {price ? formatMoney(BigInt(price)) : "…"}</p>
    </section>
  );
}
