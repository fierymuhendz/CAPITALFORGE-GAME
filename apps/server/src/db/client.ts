import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export function createDb() {
  const sqlClient = postgres(config.databaseUrl(), { max: config.dbPoolSize });
  return drizzle(sqlClient, { schema });
}
export type Db = ReturnType<typeof createDb>;
/** Transaction bağlamı: db.transaction geri çağrısına verilen nesne. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
