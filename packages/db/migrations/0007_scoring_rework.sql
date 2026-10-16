ALTER TABLE "quote" ADD COLUMN "priority_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "priority_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD COLUMN "rework_of_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_rework_of_quote_id_quote_id_fk" FOREIGN KEY ("rework_of_quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_draft_one_open_rework_uidx" ON "quote_draft" USING btree ("rework_of_quote_id") WHERE "quote_draft"."rework_of_quote_id" is not null and "quote_draft"."submitted_quote_id" is null;