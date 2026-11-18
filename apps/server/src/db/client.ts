import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export function createDb() {
  const sqlClient = postgres(config.databaseUrl(), { max: 10 });
  return drizzle(sqlClient, { schema });
}
export type Db = ReturnType<typeof createDb>;
