import Fastify from "fastify";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOMS } from "@capitalforge/shared";
import { config } from "./config";
import { MarketRoom } from "./rooms/MarketRoom";

const app = Fastify({ logger: true });
app.get("/health", async () => ({ ok: true }));

await app.ready();
const gameServer = new Server({ transport: new WebSocketTransport({ server: app.server }) });
gameServer.define(ROOMS.market, MarketRoom);

await gameServer.listen(config.port);
app.log.info(`Sunucu ${config.port} portunda hazır`);
