import { Room, ServerError, type Client } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  BuyFacilitySchema,
  ClaimReliefSchema,
  FoundCompanySchema,
  MSG,
  PlaceOrderSchema,
  StartProductionSchema,
  type ActionResult,
  type OrderResult,
} from "@capitalforge/shared";
import { asc, eq } from "drizzle-orm";
import { getSession, getSessionByHash, hashToken, type Session } from "../auth/session";
import type { Db } from "../db/client";
import { gameClock, products } from "../db/schema";
import { buyFacility } from "../company/buyFacility";
import { foundCompany } from "../company/found";
import { getCompanyView } from "../company/view";
import { executeTrade } from "../market/trade";
import type { CompletedJob } from "../production/complete";
import { startProduction } from "../production/start";
import { claimRelief } from "../relief/claim";
import { getPortfolio } from "../market/portfolio";
import { JOB_EVENT, REVOKE_EVENT, TICK_EVENT, tickBus, type TickBroadcast } from "../market/ticker";
import type { Redis } from "../redis";
import { reportError } from "../observability/log";
import { allowAction, allowOrder } from "../security/rateLimit";

/** Ürün başına herkese açık durum. Oyuncu bakiyeleri/envanteri burada yayınlanmaz. */
export class ProductState extends Schema {
  /** Kuruş cinsinden fiyat (bigint'i kayıpsız taşımak için string). */
  @type("string") price = "0";
  @type("number") tick = 0;
}

export class MarketState extends Schema {
  @type({ map: ProductState }) products = new MapSchema<ProductState>();
  /** Sunucu oyun saati (herkese açık; üretim ilerleme çubukları bununla hesaplanır). */
  @type("number") clockTick = 0;
}

export interface MarketRoomDeps {
  db: Db;
  redis: Redis;
}

/** zod şemalarının ihtiyaç duyulan yüzü (server'ın zod bağımlılığı olmadan). */
interface Parser<T> {
  safeParse(raw: unknown): { success: true; data: T } | { success: false };
}

type AuthedClient = Client<unknown, Session>;

export class MarketRoom extends Room<MarketState, unknown, unknown, Session> {
  /**
   * Bağımlılıklar süreç başında bir kez verilir (index.ts). Oda seçenekleriyle geçirilmez:
   * istemci join seçenekleri oda seçeneklerine karışabilir.
   */
  static deps: MarketRoomDeps | null = null;

  maxClients = 200;
  /** Oturum yeniden doğrulaması için istemci başına token SHA-256 özeti (ham token tutulmaz). */
  private tokens = new Map<string, string>();
  private revalidateTimer?: ReturnType<typeof setInterval>;
  static readonly REVALIDATE_MS = 60_000;
  static readonly CLOSE_SESSION_EXPIRED = 4002;
  private onTick = (b: TickBroadcast) => {
    for (const t of b.products) {
      const p = this.state.products.get(t.productId);
      if (!p) continue;
      p.price = t.price;
      p.tick = t.tick;
    }
    this.state.clockTick = b.clockTick;
  };

  /** Çıkışla iptal edilen oturumlar: eşleşen istemciler 4002 ile atılır. */
  private onRevoked = (hashes: string[]) => {
    const set = new Set(hashes);
    for (const client of [...this.clients] as AuthedClient[]) {
      const h = this.tokens.get(client.sessionId);
      if (h && set.has(h)) client.leave(MarketRoom.CLOSE_SESSION_EXPIRED);
    }
  };

  /** Biten işler yalnızca sahibine bildirilir; envanter ve şirket görünümü tazelenir. */
  private onJobs = (jobs: CompletedJob[]) => {
    const byPlayer = new Map<string, CompletedJob[]>();
    for (const j of jobs) byPlayer.set(j.playerId, [...(byPlayer.get(j.playerId) ?? []), j]);
    for (const client of this.clients as AuthedClient[]) {
      const mine = client.auth ? byPlayer.get(client.auth.playerId) : undefined;
      if (!mine || !client.auth) continue;
      for (const { playerId: _p, ...evt } of mine) client.send(MSG.jobCompleted, evt);
      void this.sendPortfolio(client, client.auth.playerId);
      void this.sendCompany(client, client.auth.playerId);
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
    if (typeof token === "string") this.tokens.set(_client.sessionId, hashToken(token));
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
    const [clock] = await this.deps.db.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
    this.state.clockTick = Number(clock?.tick ?? 0n);
    tickBus.on(TICK_EVENT, this.onTick);
    tickBus.on(JOB_EVENT, this.onJobs);
    tickBus.on(REVOKE_EVENT, this.onRevoked);
    this.revalidateTimer = setInterval(() => void this.revalidateAll(), MarketRoom.REVALIDATE_MS);

    this.onMessage(MSG.placeOrder, (client: AuthedClient, raw: unknown) => this.handleOrder(client, raw));
    this.onMessage(MSG.foundCompany, (c: AuthedClient, raw: unknown) =>
      this.handleAction(c, raw, FoundCompanySchema, foundCompany),
    );
    this.onMessage(MSG.buyFacility, (c: AuthedClient, raw: unknown) =>
      this.handleAction(c, raw, BuyFacilitySchema, buyFacility),
    );
    this.onMessage(MSG.startProduction, (c: AuthedClient, raw: unknown) =>
      this.handleAction(c, raw, StartProductionSchema, startProduction),
    );
    this.onMessage(MSG.claimRelief, (c: AuthedClient, raw: unknown) =>
      this.handleAction(c, raw, ClaimReliefSchema, claimRelief),
    );
  }

  /**
   * Ticaret dışı niyetlerin ortak girişi. Oyuncu kimliği oturumdan gelir; mesajdaki hiçbir alana
   * (sahiplik dahil) güvenilmez. Sıra: hız sınırı → zod → iş mantığı → sonuç + tazelenmiş görünümler.
   */
  private async handleAction<T extends { idempotencyKey: string }>(
    client: AuthedClient,
    raw: unknown,
    schema: Parser<T>,
    exec: (db: Db, playerId: string, input: T) => Promise<ActionResult>,
  ): Promise<void> {
    const reply = (r: ActionResult) => client.send(MSG.actionResult, r);
    const auth = client.auth;
    if (!auth) return reply({ ok: false, error: "UNAUTHORIZED" });

    const key = PlaceOrderSchema.shape.idempotencyKey.safeParse((raw as { idempotencyKey?: unknown } | null)?.idempotencyKey);
    const idempotencyKey = key.success ? key.data : undefined;
    try {
      if (!(await allowAction(this.deps.redis, auth.playerId))) {
        return reply({ ok: false, error: "RATE_LIMITED", idempotencyKey });
      }
    } catch {
      return reply({ ok: false, error: "INTERNAL", idempotencyKey });
    }

    if (!(await this.sessionValid(client))) return reply({ ok: false, error: "UNAUTHORIZED", idempotencyKey });

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "INVALID", idempotencyKey });

    const result = await exec(this.deps.db, auth.playerId, parsed.data);
    reply(result);
    if (result.ok) {
      await this.sendPortfolio(client, auth.playerId);
      await this.sendCompany(client, auth.playerId);
    }
  }

  /**
   * Oturum hâlâ geçerli mi. Token Redis'te kesin olarak yoksa false döner ve istemci 4002 ile atılır.
   * Redis hatasında da false döner (fail-closed: eylem reddedilir) ama bağlantı düşürülmez.
   */
  private async sessionValid(client: AuthedClient): Promise<boolean> {
    const hash = this.tokens.get(client.sessionId);
    try {
      const s = hash ? await getSessionByHash(this.deps.redis, hash) : null;
      if (s && client.auth && s.playerId === client.auth.playerId) return true;
    } catch {
      return false;
    }
    client.leave(MarketRoom.CLOSE_SESSION_EXPIRED);
    return false;
  }

  /** Periyodik doğrulama: Redis hatasında kimse atılmaz (geçici kesintide toplu düşüş olmaz). */
  private async revalidateAll(): Promise<void> {
    for (const client of [...this.clients] as AuthedClient[]) {
      const hash = this.tokens.get(client.sessionId);
      try {
        const s = hash ? await getSessionByHash(this.deps.redis, hash) : null;
        if (!(s && client.auth && s.playerId === client.auth.playerId)) client.leave(MarketRoom.CLOSE_SESSION_EXPIRED);
      } catch {
        // Redis geçici olarak erişilemez: bağlantıyı koru.
      }
    }
  }

  private async sendCompany(client: AuthedClient, playerId: string): Promise<void> {
    try {
      client.send(MSG.company, await getCompanyView(this.deps.db, playerId));
    } catch (err) {
      reportError(err, { what: "company hatası" });
    }
  }

  private async handleOrder(client: AuthedClient, raw: unknown): Promise<void> {
    const reply = (r: OrderResult) => client.send(MSG.orderResult, r);
    // Sahiplik: oyuncu kimliği her zaman oturumdan gelir, mesajdan değil.
    const auth = client.auth;
    if (!auth) return reply({ ok: false, error: "UNAUTHORIZED" });

    // Hız sınırı ayrıştırmadan önce: geçersiz mesaj seli de sınıra takılır.
    const key = PlaceOrderSchema.shape.idempotencyKey.safeParse((raw as { idempotencyKey?: unknown } | null)?.idempotencyKey);
    const idempotencyKey = key.success ? key.data : undefined;
    try {
      if (!(await allowOrder(this.deps.redis, auth.playerId))) {
        return reply({ ok: false, error: "RATE_LIMITED", idempotencyKey });
      }
    } catch {
      // Redis hatasında emir reddedilir (fail closed).
      return reply({ ok: false, error: "INTERNAL", idempotencyKey });
    }

    if (!(await this.sessionValid(client))) return reply({ ok: false, error: "UNAUTHORIZED", idempotencyKey });

    const parsed = PlaceOrderSchema.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "INVALID" });
    const order = parsed.data;

    const result = await executeTrade(this.deps.db, auth.playerId, order);
    reply(result);
    if (result.ok) await this.sendPortfolio(client, auth.playerId);
  }

  private async sendPortfolio(client: AuthedClient, playerId: string): Promise<void> {
    try {
      client.send(MSG.portfolio, await getPortfolio(this.deps.db, playerId));
    } catch (err) {
      reportError(err, { what: "portfolio hatası" });
    }
  }

  async onJoin(client: AuthedClient): Promise<void> {
    if (client.auth) {
      await this.sendPortfolio(client, client.auth.playerId);
      await this.sendCompany(client, client.auth.playerId);
    }
  }

  onLeave(client: AuthedClient): void {
    this.tokens.delete(client.sessionId);
  }

  onDispose(): void {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    tickBus.off(TICK_EVENT, this.onTick);
    tickBus.off(JOB_EVENT, this.onJobs);
    tickBus.off(REVOKE_EVENT, this.onRevoked);
  }
}
