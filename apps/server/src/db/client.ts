import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** Transaction nesnesi; Db ile aynı sorgu arayüzü */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, max = Number(process.env.DB_POOL_SIZE ?? 10)): { db: Db; sql: postgres.Sql } {
  const sql = postgres(url, { max, onnotice: () => {}, types: { bigint: postgres.BigInt } });
  return { db: drizzle(sql, { schema }), sql };
}

export { schema };
