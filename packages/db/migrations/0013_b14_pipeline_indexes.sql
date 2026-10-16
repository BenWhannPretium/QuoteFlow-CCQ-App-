-- B-14 pipeline views (F-07): trigram search on quote number, description and account name; the
-- "last updated" sort; and the open stage stay behind "time in stage" / aged-over.

CREATE INDEX "customer_name_trgm_idx" ON "customer" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quote_quote_number_trgm_idx" ON "quote" USING gin ("quote_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quote_description_trgm_idx" ON "quote" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quote_updated_at_idx" ON "quote" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stage_history_open_stay_idx" ON "stage_history" USING btree ("quote_id","entered_at") WHERE "stage_history"."exited_at" is null;