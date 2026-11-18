-- 0002 geri alma. Oyuncu para verisine (players, accounts, transfers, ledger_entries) dokunmaz.
-- Dikkat: şirket, tesis, üretim işi ve ödenek kayıtları SİLİNİR; üretimde olan girdiler ve tesis
-- bedelleri iade edilmez. Geri almadan önce oyunu durdurun. Defterde hareketi olan system:fees ve
-- inventories/trades/price_history satırı olan flour/steel ürünleri KORUNUR (para/stok bütünlüğü).
-- Eski fiyatları geri yükle (tick geri alınmaz; price_history'deki yeni nokta kalır).
UPDATE "products" p SET "price" = v."price", "pending_demand" = 0, "pending_supply" = 0
  FROM (VALUES ('wheat', 10000::bigint), ('iron', 25000::bigint), ('energy', 5000::bigint)) AS v("id", "price")
  WHERE p."id" = v."id";
DROP INDEX IF EXISTS "trades_volume_idx";
ALTER TABLE "trades" DROP COLUMN IF EXISTS "tick";
DROP TABLE IF EXISTS "relief_claims";
DROP TABLE IF EXISTS "player_actions";
DROP TABLE IF EXISTS "production_jobs";
DROP TABLE IF EXISTS "facilities";
DROP TABLE IF EXISTS "companies";
DROP TABLE IF EXISTS "game_clock";
DELETE FROM "accounts" a WHERE a."code" = 'system:fees'
  AND NOT EXISTS (SELECT 1 FROM "ledger_entries" e WHERE e."account_id" = a."id");
DELETE FROM "price_history" WHERE "product_id" IN ('flour', 'steel');
DELETE FROM "products" p WHERE p."id" IN ('flour', 'steel')
  AND NOT EXISTS (SELECT 1 FROM "inventories" i WHERE i."product_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "trades" t WHERE t."product_id" = p."id");
-- drizzle geçmişinden de çıkar elle yapılmalıdır:
-- DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
