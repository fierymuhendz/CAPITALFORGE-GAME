-- 0001 geri alma. Oyuncu verisine (players, accounts, transfers, ledger_entries) dokunmaz;
-- sadece 0001'in eklediği yapıları kaldırır. Defterde hareketi olan sistem hesapları korunur.
DROP INDEX IF EXISTS "players_username_lower_idx";
DROP INDEX IF EXISTS "accounts_one_wallet_per_player_idx";
DROP TABLE IF EXISTS "price_history";
DROP TABLE IF EXISTS "trades";
DROP TABLE IF EXISTS "inventories";
DROP TABLE IF EXISTS "products";
DELETE FROM "accounts" a WHERE a."code" IN ('system:mint', 'system:tax', 'system:market')
  AND NOT EXISTS (SELECT 1 FROM "ledger_entries" e WHERE e."account_id" = a."id");
-- drizzle geçmişinden de çıkar (drizzle.__drizzle_migrations son satır) elle yapılmalıdır:
-- DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
