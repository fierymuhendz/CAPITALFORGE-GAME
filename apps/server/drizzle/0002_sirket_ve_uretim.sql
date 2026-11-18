CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city_id" text DEFAULT 'merkez' NOT NULL,
	"founded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"city_id" text DEFAULT 'merkez' NOT NULL,
	"plot_x" integer NOT NULL,
	"plot_y" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"purchase_price" bigint NOT NULL,
	"upkeep_paid_period" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_level_positive" CHECK ("facilities"."level" >= 1),
	CONSTRAINT "facilities_plot_bounds" CHECK ("facilities"."plot_x" >= 0 AND "facilities"."plot_x" < 16 AND "facilities"."plot_y" >= 0 AND "facilities"."plot_y" < 16),
	CONSTRAINT "facilities_status" CHECK ("facilities"."status" IN ('active', 'suspended')),
	CONSTRAINT "facilities_price_positive" CHECK ("facilities"."purchase_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "game_clock" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"tick" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "game_clock_single_row" CHECK ("game_clock"."id" = 1),
	CONSTRAINT "game_clock_tick_nn" CHECK ("game_clock"."tick" >= 0)
);
--> statement-breakpoint
CREATE TABLE "player_actions" (
	"player_id" uuid NOT NULL,
	"client_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_actions_player_id_client_key_pk" PRIMARY KEY("player_id","client_key")
);
--> statement-breakpoint
CREATE TABLE "production_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"recipe_id" text NOT NULL,
	"batches" integer NOT NULL,
	"started_tick" bigint NOT NULL,
	"completes_at_tick" bigint NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"inputs" jsonb NOT NULL,
	"output_product_id" text NOT NULL,
	"output_qty" bigint NOT NULL,
	"completed_tick" bigint,
	CONSTRAINT "production_jobs_batches" CHECK ("production_jobs"."batches" BETWEEN 1 AND 10),
	CONSTRAINT "production_jobs_output_positive" CHECK ("production_jobs"."output_qty" > 0),
	CONSTRAINT "production_jobs_status" CHECK ("production_jobs"."status" IN ('running', 'done'))
);
--> statement-breakpoint
CREATE TABLE "relief_claims" (
	"player_id" uuid NOT NULL,
	"period" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"transfer_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relief_claims_player_id_period_pk" PRIMARY KEY("player_id","period"),
	CONSTRAINT "relief_amount_positive" CHECK ("relief_claims"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_actions" ADD CONSTRAINT "player_actions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_output_product_id_products_id_fk" FOREIGN KEY ("output_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relief_claims" ADD CONSTRAINT "relief_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relief_claims" ADD CONSTRAINT "relief_claims_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_lower_idx" ON "companies" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_plot_idx" ON "facilities" USING btree ("city_id","plot_x","plot_y");--> statement-breakpoint
CREATE INDEX "facilities_company_idx" ON "facilities" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_one_running_idx" ON "production_jobs" USING btree ("facility_id") WHERE "production_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "production_jobs_due_idx" ON "production_jobs" USING btree ("completes_at_tick") WHERE "production_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "production_jobs_player_idx" ON "production_jobs" USING btree ("player_id");--> statement-breakpoint
-- Seed: oyun saati (tek satır)
INSERT INTO "game_clock" ("id", "tick") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Seed: ücret/bakım/tesis bedeli yutağı (bakiye alanı güncellenmez, defterden türetilir)
INSERT INTO "accounts" ("kind", "code") VALUES ('system', 'system:fees') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Seed: yeni ürünler (başlangıç fiyatları PARAMS.initialPrice ile aynı, kuruş)
INSERT INTO "products" ("id", "name", "price") VALUES ('flour', 'Un', 720), ('steel', 'Çelik', 3300) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "price_history" ("product_id", "tick", "price") SELECT "id", "tick", "price" FROM "products" WHERE "id" IN ('flour', 'steel') ON CONFLICT DO NOTHING;
