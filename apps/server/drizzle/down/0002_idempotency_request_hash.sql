-- 0002_idempotency_request_hash geri alma
ALTER TABLE "cf"."idempotency_keys" DROP COLUMN IF EXISTS "request_hash";
DELETE FROM cf_migrations.migrations WHERE created_at = 1795600083012;
