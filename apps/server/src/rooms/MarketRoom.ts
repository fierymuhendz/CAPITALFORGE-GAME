import { Room, type Client } from "colyseus";
import { Schema, type } from "@colyseus/schema";
import { MSG, PlaceOrderSchema, type OrderResult } from "@capitalforge/shared";
import { nextPrice } from "@capitalforge/economy";

/** Herkese açık piyasa durumu. Oyuncu bakiyeleri burada yayınlanmaz. */
export class MarketState extends Schema {
  /** Kuruş cinsinden fiyat (bigint'i kayıpsız taşımak için string). */
  @type("string") price = "10000";
  @type("number") tick = 0;
}

const TICK_MS = 1000;

export class MarketRoom extends Room<MarketState> {
  maxClients = 200;
  private demand = 0n;
  private supply = 0n;

  onCreate(): void {
    this.setState(new MarketState());

    this.onMessage(MSG.placeOrder, (client, raw: unknown) => {
      const parsed = PlaceOrderSchema.safeParse(raw);
      if (!parsed.success) {
        client.send("orderResult", { ok: false, error: "Geçersiz istek" } satisfies OrderResult);
        return;
      }
      // TODO(backend-dev): kimlik doğrulama + ledger/transfer.ts ile para işlemi.
      const qty = BigInt(parsed.data.quantity);
      if (parsed.data.side === "buy") this.demand += qty;
      else this.supply += qty;
      client.send("orderResult", { ok: true } satisfies OrderResult);
    });

    this.setSimulationInterval(() => this.step(), TICK_MS);
  }

  private step(): void {
    this.state.price = nextPrice(BigInt(this.state.price), this.demand, this.supply).toString();
    this.state.tick += 1;
    this.demand = 0n;
    this.supply = 0n;
  }

  onJoin(client: Client): void {
    console.log(`katıldı: ${client.sessionId}`);
  }
}
