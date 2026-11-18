import { Room, ServerError, type Client } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import { MSG, PlaceOrderSchema, type OrderResult } from "@capitalforge/shared";
import { asc } from "drizzle-orm";
import { getSession, type Session } from "../auth/session";
import type { Db } from "../db/client";
import { products } from "../db/schema";
import { executeTrade } from "../market/trade";
import { getPortfolio } from "../market/portfolio";
import { TICK_EVENT, tickBus, type ProductTick } from "../market/ticker";
import type { Redis } from "../redis";
import { allowOrder } from "../security/rateLimit";

/** Ürün başına herkese açık durum. Oyuncu bakiyeleri/envanteri burada yayınlanmaz. */
export class ProductState extends Schema {
  /** Kuruş cinsinden fiyat (bigint'i kayıpsız taşımak için string). */
  @type("string") price = "0";
  @type("number") tick = 0;
}

export class MarketState extends Schema {
  @type({ map: ProductState }) products = new MapSchema<ProductState>();
}

export interface MarketRoomDeps {
  db: Db;
  redis: Redis;
}

type AuthedClient = Client<unknown, Session>;

export class MarketRoom extends Room<MarketState, unknown, unknown, Session> {
  /**
   * Bağımlılıklar süreç başında bir kez verilir (index.ts). Oda seçenekleriyle geçirilmez:
   * istemci join seçenekleri oda seçeneklerine karışabilir.
   */
  static deps: MarketRoomDeps | null = null;

  maxClients = 200;
  private onTick = (ticks: ProductTick[]) => {
    for (const t of ticks) {
      const p = this.state.products.get(t.productId);
      if (!p) continue;
      p.price = t.price;
      p.tick = t.tick;
    }
  };

  private get deps(): MarketRoomDeps {
    if (!MarketRoom.deps) throw new Error("MarketRoom.deps ayarlanmamış");
    return MarketRoom.deps;
  }

  async onAuth(_client: AuthedClient, options: unknown): Promise<Session> {
    const token = typeof options === "object" && options !== null ? (options as { token?: unknown }).token : undefined;
    let session: Session | null = null;
    try {
      session = await getSession(this.deps.redis, typeof token === "string" ? token : null);
    } catch {
      throw new ServerError(503, "INTERNAL");
    }
    if (!session) throw new ServerError(401, "UNAUTHORIZED");
    return session;
  }

  async onCreate(): Promise<void> {
    this.setState(new MarketState());
    const rows = await this.deps.db.select().from(products).orderBy(asc(products.id));
    for (const r of rows) {
      const p = new ProductState();
      p.price = r.price.toString();
      p.tick = Number(r.tick);
      this.state.products.set(r.id, p);
    }
    tickBus.on(TICK_EVENT, this.onTick);

    this.onMessage(MSG.placeOrder, (client: AuthedClient, raw: unknown) => this.handleOrder(client, raw));
  }

  private async handleOrder(client: AuthedClient, raw: unknown): Promise<void> {
    const reply = (r: OrderResult) => client.send(MSG.orderResult, r);
    // Sahiplik: oyuncu kimliği her zaman oturumdan gelir, mesajdan değil.
    const auth = client.auth;
    if (!auth) return reply({ ok: false, error: "UNAUTHORIZED" });

    const parsed = PlaceOrderSchema.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "INVALID" });
    const order = parsed.data;

    try {
      if (!(await allowOrder(this.deps.redis, auth.playerId))) {
        return reply({ ok: false, error: "RATE_LIMITED", idempotencyKey: order.idempotencyKey });
      }
    } catch {
      // Redis hatasında emir reddedilir (fail closed).
      return reply({ ok: false, error: "INTERNAL", idempotencyKey: order.idempotencyKey });
    }

    const result = await executeTrade(this.deps.db, auth.playerId, order);
    reply(result);
    if (result.ok) await this.sendPortfolio(client, auth.playerId);
  }

  private async sendPortfolio(client: AuthedClient, playerId: string): Promise<void> {
    try {
      client.send(MSG.portfolio, await getPortfolio(this.deps.db, playerId));
    } catch (err) {
      console.error("portfolio hatası", err);
    }
  }

  async onJoin(client: AuthedClient): Promise<void> {
    if (client.auth) await this.sendPortfolio(client, client.auth.playerId);
  }

  onDispose(): void {
    tickBus.off(TICK_EVENT, this.onTick);
  }
}
