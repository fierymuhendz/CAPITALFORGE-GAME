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
          include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          // Mevcut ticaret testleri taze oyuncularla çalışır; bekleme süresi testleri config'i kendisi açar.
          env: { NEW_ACCOUNT_TRADE_DELAY_SECONDS: "0" },
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
