import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["cf"],
  migrations: { schema: "cf_migrations", table: "migrations" },
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
