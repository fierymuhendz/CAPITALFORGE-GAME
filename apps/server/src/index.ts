import pino from "pino";
import { Redis } from "ioredis";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { Clock } from "./clock";
import { Catalog } from "./catalog/catalog";
import { EventBus } from "./events/bus";
import type { Deps } from "./deps";
import { buildApp } from "./http/app";
import { registerTasks } from "./http/modules";
import { startScheduler } from "./scheduler/scheduler";
import { registerAdminSetupCode } from "./auth/routes";
import { seedWorld } from "./db/seed";
import { applyCatalogRevisions } from "./db/catalogRevision";

const config = loadConfig();
const log = pino({ level: config.logLevel, redact: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.setupCode"] });
const { db, sql } = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: true });
redis.on("error", (err) => log.warn({ err: err.message }, "redis hatası"));
const clock = new Clock(config.allowTimeTravel);
const catalog = new Catalog();
const deps: Deps = { db, redis, clock, catalog, events: new EventBus(), config, log };

await seedWorld(db);
await applyCatalogRevisions(db);
await catalog.reload(db);
await clock.load(db);
await registerAdminSetupCode(deps);
setInterval(() => void catalog.reload(db).catch((err) => log.warn({ err }, "katalog tazeleme hatası")), 60_000);

registerTasks();
const app = await buildApp(deps);
await app.listen({ port: config.port, host: "0.0.0.0" });
const stop = config.schedulerEnabled ? startScheduler(deps) : () => {};
log.info({ port: config.port, timeTravel: config.allowTimeTravel }, "Capital Forge sunucusu başladı");

const shutdown = async () => {
  stop();
  await app.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
