import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { ClientErrorReq, type ServerEvent } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { AppError } from "../errors";
import { hmacHex } from "../auth/crypto";
import { sessionFromRequest } from "../auth/session";
import { registerModules } from "./modules";
import { route } from "./route";
import { companies } from "../db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.log as unknown as FastifyBaseLogger,
    trustProxy: deps.config.trustProxy,
    genReqId: () => Math.random().toString(36).slice(2, 10),
    bodyLimit: 64 * 1024,
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, reqId: req.id, details: err.details } });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string };
    if (e.validation || e.statusCode === 400 || e.code === "FST_ERR_CTP_INVALID_JSON_BODY" || e.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", reqId: req.id } });
    }
    if (e.statusCode === 413) return reply.status(413).send({ error: { code: "BAD_REQUEST", reqId: req.id } });
    // Eşzamanlı çakışma / kısıt ihlali
    const pg = err as { code?: string };
    if (pg.code === "40001" || pg.code === "40P01" || pg.code === "23505") {
      req.log.warn({ err }, "çakışma");
      return reply.status(409).send({ error: { code: "CONFLICT", reqId: req.id } });
    }
    req.log.error({ err }, "beklenmeyen hata");
    return reply.status(500).send({ error: { code: "INTERNAL", reqId: req.id } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", reqId: req.id } }));

  app.get("/health", async () => ({ ok: true, time: deps.clock.now().toISOString() }));

  // Canlı olaylar: istemci bağlanır, şirketine ait "yenile" sinyallerini alır.
  // Sınırlar: IP karması başına 5, hesap başına 3 eşzamanlı soket; oturum 5 dakikada bir yeniden doğrulanır.
  const MAX_SOCKETS_PER_IP = 5;
  const MAX_SOCKETS_PER_ACCOUNT = 3;
  const REVALIDATE_MS = 5 * 60_000;
  const socketsByIp = new Map<string, number>();
  const socketsByAccount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, d: number) => {
    const n = (m.get(k) ?? 0) + d;
    if (n <= 0) m.delete(k);
    else m.set(k, n);
  };
  app.get("/events", { websocket: true }, async (socket, req) => {
    // Kapanış/hata işleyicileri ilk iş (await öncesi): yarım kalan bağlantı sızdırmaz
    let closed = false;
    const offs: Array<() => void> = [];
    let ping: NodeJS.Timeout | null = null;
    let recheck: NodeJS.Timeout | null = null;
    const ipKey = hmacHex(deps.config.ipHashKey, req.ip || "0.0.0.0");
    let accountKey: string | null = null;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (ping) clearInterval(ping);
      if (recheck) clearInterval(recheck);
      for (const o of offs) o();
      bump(socketsByIp, ipKey, -1);
      if (accountKey) bump(socketsByAccount, accountKey, -1);
    };
    bump(socketsByIp, ipKey, 1);
    socket.on("close", cleanup);
    socket.on("error", () => { cleanup(); try { socket.terminate(); } catch { /* zaten kapalı */ } });
    socket.on("message", () => {});
    const reject = () => { cleanup(); try { socket.close(1008, "limit"); } catch { /* zaten kapalı */ } };
    if ((socketsByIp.get(ipKey) ?? 0) > MAX_SOCKETS_PER_IP) return reject();

    const session = await sessionFromRequest(deps, req).catch(() => null);
    if (closed || socket.readyState !== 1) return cleanup();
    if (session) {
      accountKey = session.account.id;
      bump(socketsByAccount, accountKey, 1);
      if ((socketsByAccount.get(accountKey) ?? 0) > MAX_SOCKETS_PER_ACCOUNT) return reject();
    }
    const send = (ev: ServerEvent) => {
      if (!closed && socket.readyState === 1) socket.send(JSON.stringify(ev));
    };
    offs.push(deps.events.on("*", send));
    if (session) {
      const c = await deps.db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.accountId, session.account.id), isNull(companies.dissolvedAt)))
        .limit(1)
        .catch(() => []);
      // bekleme sırasında kapandıysa dinleyici eklenmez
      if (closed || socket.readyState !== 1) return cleanup();
      if (c[0]) offs.push(deps.events.on(c[0].id, send));
    }
    send({ type: "hello", serverTime: deps.clock.now().toISOString() });
    ping = setInterval(() => send({ type: "hello", serverTime: deps.clock.now().toISOString() }), 25_000);
    ping.unref();
    if (session) {
      recheck = setInterval(() => {
        void sessionFromRequest(deps, req)
          .catch(() => null)
          .then((s) => {
            if (!s || s.account.id !== session.account.id || s.account.frozenAt) {
              cleanup();
              try { socket.close(1008, "session"); } catch { /* zaten kapalı */ }
            }
          });
      }, REVALIDATE_MS);
    }
  });

  // İstemci hata bildirimi (yalnızca günlüğe)
  route(app, deps, {
    method: "POST", url: "/client-errors", auth: "none", body: ClientErrorReq, rateKey: "clienterr", rateLimitPerMin: 10,
    handler: async ({ body, account }) => {
      deps.log.warn({ clientError: { message: body.message, url: body.url, stack: body.stack?.slice(0, 1500) }, accountId: account?.id }, "istemci hatası");
      return { ok: true };
    },
  });

  registerModules(app, deps);
  return app;
}
