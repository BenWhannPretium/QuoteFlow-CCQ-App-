-- B-15 revised (2026-10-22): no live pricing-app connection. The legacy app's export (ERF, BPR, SPR)
-- is imported by an Admin into pricing_history_record, read-only history for the commercial roles.
-- The hourly pricing-usage index (0014) goes: integration_run now gets one row per import.

CREATE TABLE "pricing_history_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"kind" text NOT NULL,
	"request_id" integer NOT NULL,
	"request_number" text NOT NULL,
	"request_number_key" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"status" text NOT NULL,
	"display_status" text,
	"is_open" boolean DEFAULT false NOT NULL,
	"customer" text,
	"customer_key" text,
	"product_description" text,
	"item_number" text,
	"sales_person" text,
	"market" text,
	"process" text,
	"resin" text,
	"plant_code" text,
	"plant_name" text,
	"submitted_on" date,
	"est_revenue_usd" numeric,
	"est_volume" numeric,
	"comments" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"import_run_id" uuid,
	CONSTRAINT "pricing_history_record_kind_check" CHECK ("pricing_history_record"."kind" in ('erf', 'bpr', 'spr')),
	CONSTRAINT "pricing_history_record_status_check" CHECK ("pricing_history_record"."status" in ('open', 'on_hold', 'accepted', 'rejected', 'abandoned', 'completed'))
);
--> statement-breakpoint
DROP INDEX "integration_run_pricing_hour_uq";--> statement-breakpoint
ALTER TABLE "pricing_history_record" ADD CONSTRAINT "pricing_history_record_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_history_record" ADD CONSTRAINT "pricing_history_record_import_run_id_integration_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."integration_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_history_record_kind_request_uq" ON "pricing_history_record" USING btree ("kind","request_id");--> statement-breakpoint
CREATE INDEX "pricing_history_record_number_idx" ON "pricing_history_record" USING btree ("kind","request_number_key");--> statement-breakpoint
CREATE INDEX "pricing_history_record_customer_idx" ON "pricing_history_record" USING btree ("kind","customer_key","submitted_on");--> statement-breakpoint
CREATE INDEX "pricing_history_record_customer_trgm_idx" ON "pricing_history_record" USING gin ("customer" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pricing_history_record_description_trgm_idx" ON "pricing_history_record" USING gin ("product_description" gin_trgm_ops);--> statement-breakpoint

-- RLS (second layer behind the routes' quote.read.commercialFields / config.manage): the commercial
-- roles read; only Admin writes (the import); nobody deletes.
GRANT SELECT, INSERT, UPDATE ON pricing_history_record TO ccq_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON pricing_history_record FROM ccq_app;--> statement-breakpoint
GRANT ALL ON pricing_history_record TO ccq_migrator;--> statement-breakpoint
GRANT SELECT ON pricing_history_record TO ccq_readonly;--> statement-breakpoint
ALTER TABLE pricing_history_record ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pricing_history_record FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pricing_history_record_app_select ON pricing_history_record FOR SELECT TO ccq_app
  USING (app_roles() && ARRAY['Admin', 'Leadership', 'EngLead', 'Pricing', 'PricingLead', 'Approver']::text[]);--> statement-breakpoint
CREATE POLICY pricing_history_record_app_insert ON pricing_history_record FOR INSERT TO ccq_app
  WITH CHECK ('Admin' = ANY (app_roles()));--> statement-breakpoint
CREATE POLICY pricing_history_record_app_update ON pricing_history_record FOR UPDATE TO ccq_app
  USING ('Admin' = ANY (app_roles())) WITH CHECK ('Admin' = ANY (app_roles()));--> statement-breakpoint
CREATE POLICY pricing_history_record_migrator ON pricing_history_record FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY pricing_history_record_readonly ON pricing_history_record FOR SELECT TO ccq_readonly USING (true);
