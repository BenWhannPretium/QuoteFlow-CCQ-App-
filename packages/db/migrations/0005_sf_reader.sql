ALTER TABLE "quote" ADD COLUMN "sf_status_flag" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "sf_status_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "is_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "is_won" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "system_modstamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "deleted_in_sf_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD COLUMN "data_quality" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "sf_opportunity_snapshot_account_name_trgm_idx" ON "sf_opportunity_snapshot" USING gin ("account_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sf_opportunity_snapshot_owner_email_idx" ON "sf_opportunity_snapshot" USING btree ("owner_email");--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_sf_status_flag_check" CHECK ("quote"."sf_status_flag" is null or "quote"."sf_status_flag" in ('closed_won', 'closed_lost', 'deleted'));