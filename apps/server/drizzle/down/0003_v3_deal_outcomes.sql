-- 0003_v3_deal_outcomes geri alma (yalnızca tahmin kayıtları silinir; oyun verisine dokunulmaz)
DROP TABLE IF EXISTS "cf"."deal_outcomes";
DELETE FROM cf_migrations.migrations WHERE created_at = 1795617389977;
