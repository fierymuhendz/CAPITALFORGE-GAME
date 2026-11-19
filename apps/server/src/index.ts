import Fastify from "fastify";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOMS } from "@capitalforge/shared";
import { config } from "./config";
import { createDb } from "./db/client";
import { registerRoutes } from "./http/routes";
import { bridgeTicks, startTicker } from "./market/ticker";
import { createRedis } from "./redis";
import { MarketRoom } from "./rooms/MarketRoom";

const db = createDb();
const redis = createRedis();

const app = Fastify({ logger: true, trustProxy: config.trustProxy });
registerRoutes(app, { db, redis });

await app.ready();
MarketRoom.deps = { db, redis };
const gameServer = new Server({ transport: new WebSocketTransport({ server: app.server }) });
gameServer.define(ROOMS.market, MarketRoom);

// Tick sonuçlarını Redis kanalından odalara aktar, sonra tek tick döngüsünü başlat.
const stopBridge = await bridgeTicks(redis.duplicate());
const stopTicker = startTicker(db, redis);

await gameServer.listen(config.port);
app.log.info(`Sunucu ${config.port} portunda hazır`);

async function shutdown(): Promise<void> {
  stopTicker();
  await stopBridge().catch(() => undefined);
  await gameServer.gracefullyShutdown(false).catch(() => undefined);
  await app.close().catch(() => undefined);
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
