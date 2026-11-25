CREATE SCHEMA "cf";
--> statement-breakpoint
CREATE TABLE "cf"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"username_lower" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"graphics" text DEFAULT 'auto' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_last_step" bigint,
	"can_review_connections" boolean DEFAULT false NOT NULL,
	"frozen_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cf"."admin_setup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	CONSTRAINT "admin_setup_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "cf"."connection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."idempotency_keys" (
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cf"."catalog_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"item_id" text NOT NULL,
	"version" integer NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"reasoning" text
);
--> statement-breakpoint
CREATE TABLE "cf"."catalog_items" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "catalog_items_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "cf"."meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."plots" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"gx" integer NOT NULL,
	"gz" integer NOT NULL,
	"price" bigint NOT NULL,
	"min_level" integer NOT NULL,
	"size_ha" integer NOT NULL,
	"fertility_bp" integer NOT NULL,
	"pasture_bp" integer NOT NULL,
	"deposit_kind" text,
	"deposit_richness_bp" integer,
	"distance_to_center_km" integer NOT NULL,
	"owner_company_id" uuid,
	"purchased_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cf"."price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"city_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"ref_price_per_kg" bigint NOT NULL,
	"vwap_per_kg" bigint,
	"volume_kg" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."price_refs" (
	"product_id" text NOT NULL,
	"city_id" text NOT NULL,
	"drift_bp" integer DEFAULT 10000 NOT NULL,
	"ref_price_per_kg" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_refs_product_id_city_id_pk" PRIMARY KEY("product_id","city_id")
);
--> statement-breakpoint
CREATE TABLE "cf"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cf"."system_daily" (
	"company_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"day" date NOT NULL,
	"bought_kg" bigint DEFAULT 0 NOT NULL,
	"sold_kg" bigint DEFAULT 0 NOT NULL,
	"spent" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "system_daily_company_id_product_id_day_pk" PRIMARY KEY("company_id","product_id","day")
);
--> statement-breakpoint
CREATE TABLE "cf"."world_clock" (
	"id" integer PRIMARY KEY NOT NULL,
	"offset_ms" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"name_lower" text NOT NULL,
	"sector" text NOT NULL,
	"home_city_id" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"on_time_deliveries" integer DEFAULT 0 NOT NULL,
	"late_or_missed" integer DEFAULT 0 NOT NULL,
	"next_upkeep_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dissolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cf"."company_snapshots" (
	"company_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"cash" bigint NOT NULL,
	"net_worth" bigint NOT NULL,
	CONSTRAINT "company_snapshots_company_id_at_pk" PRIMARY KEY("company_id","at")
);
--> statement-breakpoint
CREATE TABLE "cf"."facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plot_id" text NOT NULL,
	"city_id" text NOT NULL,
	"type" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"quality_level" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"construction_ends_at" timestamp with time zone,
	"upgrade_kind" text,
	"upgrade_target" integer,
	"upgrade_ends_at" timestamp with time zone,
	"stalled_reason" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"city_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint DEFAULT 0 NOT NULL,
	"reserved_kg" bigint DEFAULT 0 NOT NULL,
	"cost_total" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_qty_ok" CHECK (qty_kg >= 0 AND reserved_kg >= 0 AND reserved_kg <= qty_kg AND cost_total >= 0)
);
--> statement-breakpoint
CREATE TABLE "cf"."inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"city_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"breakdown" jsonb,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal" bigint NOT NULL,
	"outstanding" bigint NOT NULL,
	"daily_interest_bp" integer NOT NULL,
	"term_days" integer NOT NULL,
	"paid_installments" integer DEFAULT 0 NOT NULL,
	"next_due_at" timestamp with time zone,
	"last_payment_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"interest_paid" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."production_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"city_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"recipe_version" integer NOT NULL,
	"recipe_snapshot" jsonb NOT NULL,
	"batches" integer NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"output_product_id" text NOT NULL,
	"output_kg" bigint NOT NULL,
	"output_quality" integer NOT NULL,
	"cost_breakdown" jsonb NOT NULL,
	"cost_total" bigint NOT NULL,
	"start_transaction_id" uuid,
	"settle_transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cf"."research" (
	"company_id" uuid NOT NULL,
	"research_id" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"target_level" integer,
	"ends_at" timestamp with time zone,
	CONSTRAINT "research_company_id_research_id_pk" PRIMARY KEY("company_id","research_id")
);
--> statement-breakpoint
CREATE TABLE "cf"."starter_grants" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"facility_id" uuid,
	"vehicle_id" uuid,
	"transaction_id" uuid,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_cash_nonneg" CHECK (company_id IS NULL OR code <> 'cash' OR balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "cf"."ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"memo" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."market_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"side" text NOT NULL,
	"company_id" uuid NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"city_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint NOT NULL,
	"remaining_kg" bigint NOT NULL,
	"price_per_kg" bigint NOT NULL,
	"escrow_remaining" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"first_fill_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "orders_remaining_ok" CHECK (remaining_kg >= 0 AND remaining_kg <= qty_kg AND escrow_remaining >= 0)
);
--> statement-breakpoint
CREATE TABLE "cf"."sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_company_id" uuid NOT NULL,
	"buyer_company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"city_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint NOT NULL,
	"price_per_kg" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"cogs" bigint NOT NULL,
	"freight" bigint DEFAULT 0 NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"net_profit" bigint NOT NULL,
	"trade_id" uuid,
	"contract_id" uuid,
	"installment_id" uuid,
	"shipment_id" uuid,
	"transaction_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_company_id" uuid NOT NULL,
	"seller_company_id" uuid NOT NULL,
	"buyer_is_system" boolean NOT NULL,
	"seller_is_system" boolean NOT NULL,
	"city_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint NOT NULL,
	"price_per_kg" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"transaction_id" uuid NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."contract_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installment_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"qty_kg" bigint NOT NULL,
	"quality" integer NOT NULL,
	"late" boolean NOT NULL,
	"shipment_id" uuid,
	"sale_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."contract_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"window_opens_at" timestamp with time zone NOT NULL,
	"grace_ends_at" timestamp with time zone NOT NULL,
	"qty_due_kg" bigint NOT NULL,
	"qty_delivered_kg" bigint DEFAULT 0 NOT NULL,
	"qty_late_kg" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"escrow_remaining" bigint NOT NULL,
	"deposit_share" bigint NOT NULL,
	"paid_to_seller" bigint DEFAULT 0 NOT NULL,
	"late_fees" bigint DEFAULT 0 NOT NULL,
	"penalty" bigint DEFAULT 0 NOT NULL,
	"refunded_to_buyer" bigint DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"settle_transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cf"."contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"proposer_company_id" uuid NOT NULL,
	"proposer_role" text NOT NULL,
	"counterparty_company_id" uuid,
	"seller_company_id" uuid,
	"buyer_company_id" uuid,
	"product_id" text NOT NULL,
	"min_quality" integer NOT NULL,
	"qty_per_installment_kg" bigint NOT NULL,
	"price_per_kg" bigint NOT NULL,
	"delivery_city_id" text NOT NULL,
	"freight_payer" text NOT NULL,
	"installments" integer NOT NULL,
	"first_due_at" timestamp with time zone NOT NULL,
	"interval_hours" integer NOT NULL,
	"grace_hours" integer NOT NULL,
	"penalty_bp" integer NOT NULL,
	"late_fee_bp" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"note" text,
	"terms" jsonb,
	"buyer_escrow" bigint DEFAULT 0 NOT NULL,
	"seller_deposit" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cf"."freight_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"shipper_company_id" uuid NOT NULL,
	"consignee_company_id" uuid NOT NULL,
	"origin_city_id" text NOT NULL,
	"dest_city_id" text NOT NULL,
	"distance_km" integer NOT NULL,
	"cargo" jsonb NOT NULL,
	"total_kg" bigint NOT NULL,
	"pay_amount" bigint NOT NULL,
	"installment_id" uuid,
	"allow_system_carrier" boolean DEFAULT true NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"carrier_company_id" uuid,
	"shipment_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "freight_pay_pos" CHECK (pay_amount > 0)
);
--> statement-breakpoint
CREATE TABLE "cf"."shipment_cargo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"owner_company_id" uuid NOT NULL,
	"consignee_company_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"quality" integer NOT NULL,
	"qty_kg" bigint NOT NULL,
	"cost_basis" bigint NOT NULL,
	"freight_allocated" bigint DEFAULT 0 NOT NULL,
	"installment_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cf"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"carrier_company_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"freight_job_id" uuid,
	"origin_city_id" text NOT NULL,
	"dest_city_id" text NOT NULL,
	"distance_km" integer NOT NULL,
	"capacity_kg" bigint NOT NULL,
	"departed_at" timestamp with time zone NOT NULL,
	"arrives_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"fuel_cost" bigint NOT NULL,
	"driver_cost" bigint NOT NULL,
	"depart_transaction_id" uuid,
	"arrive_transaction_id" uuid,
	"proof" jsonb
);
--> statement-breakpoint
CREATE TABLE "cf"."vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"city_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"garage_facility_id" uuid,
	"current_shipment_id" uuid,
	"purchased_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_account_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."admin_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"by_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"action" text,
	"target_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf"."admin_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "cf"."alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"product_id" text,
	"city_id" text,
	"company_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"details" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cf"."admin_setup_codes" ADD CONSTRAINT "admin_setup_codes_used_by_accounts_id_fk" FOREIGN KEY ("used_by") REFERENCES "cf"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."connection_records" ADD CONSTRAINT "connection_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "cf"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "cf"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."facilities" ADD CONSTRAINT "facilities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "cf"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."production_jobs" ADD CONSTRAINT "production_jobs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "cf"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."starter_grants" ADD CONSTRAINT "starter_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "cf"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "cf"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "cf"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."contract_deliveries" ADD CONSTRAINT "contract_deliveries_installment_id_contract_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "cf"."contract_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."contract_installments" ADD CONSTRAINT "contract_installments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "cf"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."shipment_cargo" ADD CONSTRAINT "shipment_cargo_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "cf"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf"."admin_case_events" ADD CONSTRAINT "admin_case_events_case_id_admin_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cf"."admin_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_lower_uq" ON "cf"."accounts" USING btree ("username_lower");--> statement-breakpoint
CREATE UNIQUE INDEX "conn_account_ip_uq" ON "cf"."connection_records" USING btree ("account_id","ip_hash");--> statement-breakpoint
CREATE INDEX "conn_ip_idx" ON "cf"."connection_records" USING btree ("ip_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idem_uq" ON "cf"."idempotency_keys" USING btree ("account_id","key");--> statement-breakpoint
CREATE INDEX "notif_company_idx" ON "cf"."notifications" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "cf"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "cf"."sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "plots_city_idx" ON "cf"."plots" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "price_hist_idx" ON "cf"."price_history" USING btree ("product_id","city_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_uq" ON "cf"."companies" USING btree ("name_lower") WHERE dissolved_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_account_uq" ON "cf"."companies" USING btree ("account_id") WHERE dissolved_at IS NULL AND account_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_system_key_uq" ON "cf"."companies" USING btree ("system_key");--> statement-breakpoint
CREATE INDEX "companies_upkeep_idx" ON "cf"."companies" USING btree ("next_upkeep_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_plot_uq" ON "cf"."facilities" USING btree ("plot_id") WHERE state <> 'demolished';--> statement-breakpoint
CREATE INDEX "facilities_company_idx" ON "cf"."facilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "facilities_construction_idx" ON "cf"."facilities" USING btree ("construction_ends_at");--> statement-breakpoint
CREATE INDEX "facilities_upgrade_idx" ON "cf"."facilities" USING btree ("upgrade_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_uq" ON "cf"."holdings" USING btree ("company_id","city_id","product_id","quality");--> statement-breakpoint
CREATE INDEX "movements_company_idx" ON "cf"."inventory_movements" USING btree ("company_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "loans_due_idx" ON "cf"."loans" USING btree ("next_due_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "loans_company_idx" ON "cf"."loans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "cf"."production_jobs" USING btree ("ends_at") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "jobs_facility_idx" ON "cf"."production_jobs" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "cf"."production_jobs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "research_due_idx" ON "cf"."research" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_uq" ON "cf"."ledger_accounts" USING btree (coalesce("company_id"::text, 'sys'),"code");--> statement-breakpoint
CREATE INDEX "ledger_entries_tx_idx" ON "cf"."ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "cf"."ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tx_idem_uq" ON "cf"."ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_tx_ref_idx" ON "cf"."ledger_transactions" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "orders_book_idx" ON "cf"."market_orders" USING btree ("city_id","product_id","side","status");--> statement-breakpoint
CREATE INDEX "orders_company_idx" ON "cf"."market_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sales_seller_idx" ON "cf"."sales" USING btree ("seller_company_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_buyer_idx" ON "cf"."sales" USING btree ("buyer_company_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_pc_idx" ON "cf"."trades" USING btree ("product_id","city_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "cf"."trades" USING btree ("buyer_company_id");--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "cf"."trades" USING btree ("seller_company_id");--> statement-breakpoint
CREATE INDEX "deliveries_installment_idx" ON "cf"."contract_deliveries" USING btree ("installment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_seq_uq" ON "cf"."contract_installments" USING btree ("contract_id","seq");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "cf"."contract_installments" USING btree ("grace_ends_at") WHERE settled_at IS NULL;--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "cf"."contracts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "contracts_seller_idx" ON "cf"."contracts" USING btree ("seller_company_id");--> statement-breakpoint
CREATE INDEX "contracts_buyer_idx" ON "cf"."contracts" USING btree ("buyer_company_id");--> statement-breakpoint
CREATE INDEX "contracts_proposer_idx" ON "cf"."contracts" USING btree ("proposer_company_id");--> statement-breakpoint
CREATE INDEX "freight_status_idx" ON "cf"."freight_jobs" USING btree ("status","origin_city_id");--> statement-breakpoint
CREATE INDEX "freight_shipper_idx" ON "cf"."freight_jobs" USING btree ("shipper_company_id");--> statement-breakpoint
CREATE INDEX "freight_carrier_idx" ON "cf"."freight_jobs" USING btree ("carrier_company_id");--> statement-breakpoint
CREATE INDEX "cargo_shipment_idx" ON "cf"."shipment_cargo" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "cargo_owner_idx" ON "cf"."shipment_cargo" USING btree ("owner_company_id");--> statement-breakpoint
CREATE INDEX "shipments_due_idx" ON "cf"."shipments" USING btree ("arrives_at") WHERE status = 'in_transit';--> statement-breakpoint
CREATE INDEX "shipments_carrier_idx" ON "cf"."shipments" USING btree ("carrier_company_id","departed_at");--> statement-breakpoint
CREATE INDEX "vehicles_company_idx" ON "cf"."vehicles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "vehicles_city_idx" ON "cf"."vehicles" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "cf"."admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "case_events_idx" ON "cf"."admin_case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_uq" ON "cf"."alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_kind_idx" ON "cf"."alerts" USING btree ("kind","created_at");