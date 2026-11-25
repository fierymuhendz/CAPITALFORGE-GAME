/**
 * Entegrasyon testi düzeneği. Her test dosyası kendi temiz veritabanıyla başlar:
 * cf şeması silinir, migration + tohumlama yeniden çalışır. Gerçek PostgreSQL kullanılır.
 * DATABASE_URL test veritabanını göstermeli (adı "test" içermeli; yanlışlıkla canlıya dokunulmaz).
 *
 * Kullanım:
 *   const h = await createHarness();
 *   const a = await h.player("ali");            // kayıtlı oturum
 *   await a.post("/company", {...});
 *   await h.advance(60 * 60_000);               // test saati ileri + zamanlayıcı
 *   await h.close();
 */
import pino from "pino";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "@capitalforge/shared";
import { settings } from "../db/schema";
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { Clock } from "../clock";
import { Catalog } from "../catalog/catalog";
import { EventBus } from "../events/bus";
import type { Deps } from "../deps";
import { loadConfig } from "../config";
import { buildApp } from "../http/app";
import { registerTasks } from "../http/modules";
import { resetTaskTimers, runDue } from "../scheduler/scheduler";

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export class Player {
  cookie = "";
  constructor(readonly h: Harness, readonly username: string, readonly ip: string) {}
  private async call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<ApiResult<T>> {
    const res = await this.h.app.inject({
      method, url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(method !== "GET" ? { "x-cf-intent": "1", "content-type": "application/json" } : {}) },
      remoteAddress: this.ip,
      payload: method !== "GET" ? JSON.stringify(payload ?? {}) : undefined,
    });
    const set = res.headers["set-cookie"];
    const first = Array.isArray(set) ? set[0] : set;
    if (first && first.startsWith("cf_session=")) this.cookie = first.split(";")[0]!;
    let body: unknown = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body: body as T };
  }
  get<T = any>(url: string) { return this.call<T>("GET", url); }
  post<T = any>(url: string, body?: unknown) { return this.call<T>("POST", url, body); }
  patch<T = any>(url: string, body?: unknown) { return this.call<T>("PATCH", url, body); }
  del<T = any>(url: string, body?: unknown) { return this.call<T>("DELETE", url, body); }
  /** başarı bekle; değilse hata mesajıyla düş */
  async ok<T = any>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export interface Harness {
  deps: Deps;
  app: FastifyInstance;
  player(username?: string, ip?: string): Promise<Player>;
  /** test saatini ilerlet ve zamanlayıcıyı (adım adım) çalıştır */
  advance(ms: number, stepMs?: number): Promise<void>;
  tick(): Promise<Record<string, number>>;
  close(): Promise<void>;
  key(): string;
}

/**
 * keepDb: true → şema silinmez (sunucu yeniden başlatma / ikinci yayın simülasyonu). Migration + tohumlama
 * yine çalışır (idempotent olmalı); saat ofseti veritabanından yüklenir.
 */
export async function createHarness(opts?: { schedulerTasks?: boolean; keepDb?: boolean; playtestSeconds?: number }): Promise<Harness> {
  const url = process.env.DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge_test";
  if (!/test/.test(url)) throw new Error("Test DATABASE_URL adı 'test' içermeli");
  if (!opts?.keepDb) {
    const admin = createDb(url, 1);
    await admin.db.execute(sql`DROP SCHEMA IF EXISTS cf CASCADE`);
    await admin.db.execute(sql`DROP SCHEMA IF EXISTS cf_migrations CASCADE`);
    await admin.sql.end();
  }
  await runMigrations(url);
  const config = { ...loadConfig({ ...process.env, NODE_ENV: "test", ALLOW_TIME_TRAVEL: "1", DATABASE_URL: url }), secureCookies: false };
  const { db, sql: client } = createDb(url, 5);
  // Oyun testi kipi (varsayılan ayar 60 sn) testlerde varsayılan olarak kapalı: mevcut senaryolar normal tempoyu doğrular.
  // Kipi deneyen testler { playtestSeconds: 60 } verir.
  {
    const cur = (await db.select().from(settings).where(eq(settings.key, "pace")).limit(1))[0];
    const value = { ...DEFAULT_SETTINGS.pace, ...((cur?.value as object | undefined) ?? {}), playtestSeconds: opts?.playtestSeconds ?? 0 };
    await db.insert(settings).values({ key: "pace", value, updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  const clock = new Clock(true);
  const catalog = new Catalog();
  await catalog.reload(db);
  await clock.load(db);
  const log = pino({ level: process.env.TEST_LOG ?? "silent" });
  const deps: Deps = { db, redis: null, clock, catalog, events: new EventBus(), config, log };
  if (opts?.schedulerTasks !== false) registerTasks();
  await resetTaskTimers();
  const app = await buildApp(deps);
  await app.ready();
  let n = 0;
  const h: Harness = {
    deps, app,
    async player(username, ip) {
      n++;
      const name = username ?? `oyuncu${n}_${Math.random().toString(36).slice(2, 6)}`;
      const p = new Player(h, name, ip ?? `10.0.${Math.floor(n / 250)}.${(n % 250) + 1}`);
      await p.ok("POST", "/auth/register", { username: name, password: "parola-123456", locale: "tr" });
      return p;
    },
    async advance(ms, stepMs = 15 * 60_000) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(stepMs, left);
        await clock.advance(db, step);
        await runDue(deps, clock.now(), true);
        left -= step;
      }
    },
    tick: () => runDue(deps, clock.now(), true),
    async close() {
      await app.close();
      await client.end({ timeout: 2 });
    },
    key: () => randomUUID().replaceAll("-", ""),
  };
  return h;
}
