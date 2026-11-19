CREATE TABLE "inventories" (
	"player_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "inventories_player_id_product_id_pk" PRIMARY KEY("player_id","product_id"),
	CONSTRAINT "inventory_non_negative" CHECK ("inventories"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"product_id" text NOT NULL,
	"tick" bigint NOT NULL,
	"price" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_product_id_tick_pk" PRIMARY KEY("product_id","tick")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" bigint NOT NULL,
	"pending_demand" bigint DEFAULT 0 NOT NULL,
	"pending_supply" bigint DEFAULT 0 NOT NULL,
	"tick" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "products_price_min" CHECK ("products"."price" >= 1),
	CONSTRAINT "products_pending_demand_nn" CHECK ("products"."pending_demand" >= 0),
	CONSTRAINT "products_pending_supply_nn" CHECK ("products"."pending_supply" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"client_key" uuid NOT NULL,
	"side" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"tax" bigint NOT NULL,
	"transfer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_transfer_id_unique" UNIQUE("transfer_id"),
	CONSTRAINT "trades_quantity_positive" CHECK ("trades"."quantity" > 0),
	CONSTRAINT "trades_side" CHECK ("trades"."side" IN ('buy', 'sell')),
	CONSTRAINT "trades_amounts_non_negative" CHECK ("trades"."unit_price" >= 0 AND "trades"."gross" >= 0 AND "trades"."tax" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_player_client_key_idx" ON "trades" USING btree ("player_id","client_key");--> statement-breakpoint
CREATE INDEX "trades_player_created_idx" ON "trades" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_one_wallet_per_player_idx" ON "accounts" USING btree ("player_id") WHERE "accounts"."kind" = 'player';--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_lower_idx" ON "players" USING btree (lower("username"));--> statement-breakpoint
-- Seed: sistem hesapları (bakiye alanı güncellenmez, bakiye defterden türetilir)
INSERT INTO "accounts" ("kind", "code") VALUES ('system', 'system:mint'), ('system', 'system:tax'), ('system', 'system:market') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Seed: ürünler ve başlangıç fiyatları (kuruş)
INSERT INTO "products" ("id", "name", "price") VALUES ('wheat', 'Buğday', 10000), ('iron', 'Demir', 25000), ('energy', 'Enerji', 5000) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "price_history" ("product_id", "tick", "price") SELECT "id", 0, "price" FROM "products" ON CONFLICT DO NOTHING;
