CREATE TABLE "quote_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"owner_user_id" uuid NOT NULL,
	"sf_opportunity_id" text,
	"step" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_quote_id" uuid,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "quote_draft_step_check" CHECK ("quote_draft"."step" between 1 and 4),
	CONSTRAINT "quote_draft_submitted_consistency_check" CHECK (("quote_draft"."submitted_quote_id" is null) = ("quote_draft"."submitted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "contact" jsonb;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "est_annual_revenue_sf" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "est_annual_volume_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "ship_to_original" jsonb;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "ship_to_override_reason" text;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_submitted_quote_id_quote_id_fk" FOREIGN KEY ("submitted_quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_draft_owner_idx" ON "quote_draft" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_one_active_per_opportunity_uidx" ON "quote" USING btree ("sf_opportunity_id") WHERE "quote"."status" <> 'closed';--> statement-breakpoint

-- ── B-07: quote_draft row-level security. A draft is visible only to its creator, plus Admin. ──
-- Explicit grants (the 0004 default privileges only cover tables created by the same role).
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_draft TO ccq_app;
--> statement-breakpoint
GRANT SELECT ON quote_draft TO ccq_readonly;
--> statement-breakpoint
GRANT ALL ON quote_draft TO ccq_migrator;
--> statement-breakpoint
ALTER TABLE quote_draft ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_draft FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_draft_app ON quote_draft FOR ALL TO ccq_app
  USING (owner_user_id = app_user_id() OR 'Admin' = ANY (app_roles()))
  WITH CHECK (owner_user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY quote_draft_migrator ON quote_draft FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY quote_draft_readonly ON quote_draft FOR SELECT TO ccq_readonly USING (true);
