import { defineConfig } from "vitest/config";

/**
 * unit: saf birim testleri (ekonomi, şemalar, ledger doğrulaması). Veritabanı gerektirmez.
 * integration: *.int.test.ts, gerçek PostgreSQL ve Redis üzerinde. Dosyalar sırayla çalışır
 * (aynı test veritabanını paylaşırlar). DATABASE_URL ve REDIS_URL gerekir.
 */
export default defineConfig({
  test: {
    // Integration dosyaları aynı test veritabanını paylaşır: dosyalar sırayla çalışmalı.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts", "apps/web/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          // Her dosya kendi temiz şemasıyla başlar (test/harness.ts).
          env: { DISABLE_RATE_LIMIT: "1", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge_test" },
          include: ["packages/**/*.int.test.ts", "apps/server/**/*.int.test.ts"],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
