CREATE TABLE "cf"."deal_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"product_id" text,
	"recipe_id" text,
	"city_id" text,
	"dest_city_id" text,
	"expected" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deal_outcomes_uq" ON "cf"."deal_outcomes" USING btree ("company_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "deal_outcomes_company_idx" ON "cf"."deal_outcomes" USING btree ("company_id","created_at");