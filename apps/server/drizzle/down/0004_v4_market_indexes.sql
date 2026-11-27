-- 0004_v4_market_indexes geri alma (yalnızca indeksler; oyun verisine dokunulmaz)
DROP INDEX IF EXISTS "cf"."ledger_tx_reverses_idx";
DROP INDEX IF EXISTS "cf"."alerts_trade_idx";
DELETE FROM cf_migrations.migrations WHERE created_at = 1795787294438;
