import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Catalog } from "./catalog/catalog";
import type { Clock } from "./clock";
import type { Config } from "./config";
import type { Db, Tx } from "./db/client";
import { EventBus, UnitOfWork } from "./events/bus";

export interface Deps {
  db: Db;
  redis: Redis | null;
  clock: Clock;
  catalog: Catalog;
  events: EventBus;
  config: Config;
  log: Logger;
}

/** Bir veritabanı işlemi aç; başarıyla biterse biriken olayları yayınla. */
export async function withTx<T>(deps: Deps, fn: (tx: Tx, uow: UnitOfWork) => Promise<T>): Promise<T> {
  const uow = new UnitOfWork();
  const out = await deps.db.transaction((tx) => fn(tx, uow));
  uow.flush(deps.events);
  return out;
}
