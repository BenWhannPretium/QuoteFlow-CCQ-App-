CREATE TABLE "sf_writeback_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"sf_opportunity_id" text NOT NULL,
	"event" text NOT NULL,
	"sf_object" text NOT NULL,
	"sf_field" text NOT NULL,
	"value" text NOT NULL,
	"payload" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"closing" boolean DEFAULT false NOT NULL,
	"reopens" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"skipped_reason" text,
	"response" text,
	CONSTRAINT "sf_writeback_outbox_event_check" CHECK ("sf_writeback_outbox"."event" in ('outcome_recorded', 'requote_started', 'stage_changed', 'quote_link')),
	CONSTRAINT "sf_writeback_outbox_object_check" CHECK ("sf_writeback_outbox"."sf_object" in ('Opportunity')),
	CONSTRAINT "sf_writeback_outbox_status_check" CHECK ("sf_writeback_outbox"."status" in ('pending', 'sent', 'failed', 'skipped', 'dry_run')),
	CONSTRAINT "sf_writeback_outbox_skipped_reason_check" CHECK ("sf_writeback_outbox"."skipped_reason" is null or "sf_writeback_outbox"."skipped_reason" in ('superseded', 'regression', 'other_active_quote', 'nothing_to_reopen', 'moved_in_salesforce', 'admin_skip')),
	CONSTRAINT "sf_writeback_outbox_last_error_check" CHECK ("sf_writeback_outbox"."last_error" is null or char_length("sf_writeback_outbox"."last_error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "sf_writeback_outbox" ADD CONSTRAINT "sf_writeback_outbox_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf_writeback_outbox" ADD CONSTRAINT "sf_writeback_outbox_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sf_writeback_outbox_dedupe_key_uq" ON "sf_writeback_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "sf_writeback_outbox_due_idx" ON "sf_writeback_outbox" USING btree ("next_attempt_at") WHERE "sf_writeback_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "sf_writeback_outbox_opportunity_idx" ON "sf_writeback_outbox" USING btree ("sf_opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "sf_writeback_outbox_quote_idx" ON "sf_writeback_outbox" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "sf_writeback_outbox_created_idx" ON "sf_writeback_outbox" USING btree ("created_at");--> statement-breakpoint
-- ── FB-29 (hand-written): the Salesforce write-back outbox, switched off ─────────────────────────────────
-- Feedback N19-01 (Darren Miller, Sarah Brennan) and N19-02 (Sarah Brennan, Oleg Yarovinski, Bailey Schmitt),
-- the 2026-11-19 meeting; D-16w, F-035. Synthetic data only.
--
-- The statements above create sf_writeback_outbox: the durable queue of writes to Salesforce, written in the
-- transaction of the change that causes them and sent by the write-back worker. Fabric (rule 10): text,
-- integer, boolean, uuid and timestamptz only (the payload and response are JSON as text), so nothing needs
-- a companion.
--
-- 1. Row-level security: a quote child, visible when the parent quote is (as 0042 / 0055). The worker runs
-- in the system context (Admin, all scope) and sees every row.
ALTER TABLE "sf_writeback_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sf_writeback_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sf_writeback_outbox_app" ON "sf_writeback_outbox" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "sf_writeback_outbox".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "sf_writeback_outbox".quote_id));--> statement-breakpoint
CREATE POLICY "sf_writeback_outbox_migrator" ON "sf_writeback_outbox" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sf_writeback_outbox_readonly" ON "sf_writeback_outbox" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
-- The app updates a row's state but never deletes or truncates one (rule 10; the outbox is the record of what
-- was sent).
REVOKE DELETE, TRUNCATE ON "sf_writeback_outbox" FROM ccq_app;--> statement-breakpoint
--
-- 2. The settings (provisional, switched off). As 0055: on a fresh database the config tables are empty here,
-- so the insert is a no-op and the seed inserts the same rows. ON CONFLICT: an existing row (an Admin's value)
-- is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('sf_writeback_enabled', 'false', 'FB-29 (N19-01): the master switch for writing to Salesforce. Off: nothing is queued or written, and the KAM is reminded to update the opportunity by hand. Stays off until IT grants a write identity and the Salesforce owner approves sf_writeback_map (docs/build-guide/10-salesforce-writeback.md). Provisional.'),
  ('sf_writeback_mode', '"dry_run"', 'FB-29: dry_run records in the outbox what would be sent and sends nothing; live sends through the write connection. Live is refused unless this environment has one (SF_WRITE_MODE, with its guards). Provisional.'),
  ('sf_writeback_map', '{"entries":[{"event":"outcome_recorded","enabled":true,"sfObject":"Opportunity","sfField":"StageName","value":{"source":"sf_outcome_stage_names"},"closing":["lost","expired"],"reopens":false},{"event":"requote_started","enabled":true,"sfObject":"Opportunity","sfField":"StageName","value":{"source":"sf_outcome_stage_names","key":"requote"},"closing":[],"reopens":true},{"event":"stage_changed","enabled":false,"sfObject":"Opportunity","sfField":"StageName","value":{"source":"stage_map"},"closing":[],"reopens":false},{"event":"quote_link","enabled":false,"sfObject":"Opportunity","sfField":null,"value":{"source":"quote_number"},"closing":[],"reopens":false}],"stageMap":{},"stageRank":{"Prospecting":10,"Qualification / Needs Analysis":20,"Qualifying":20,"RFP / Quote Entry - In Process":30,"Quoting":30,"Quoted":40,"Final Review":40,"Negotiating":50,"Negotiation / Customer Testing":50,"Verbal Award":60,"Verbal Award / Tool PO in Hand":70,"PO(s) in hand":70,"Closed Lost":90,"Closed Won - Product Shipping":100}}', 'FB-29 (F-035): what is written, and where. entries: one per event (outcome_recorded: the stage for the G5 outcome from sf_outcome_stage_names, closing for lost and expired; requote_started: reopens to the requote stage, only over a close QuoteFlow wrote; stage_changed: through stageMap, empty so off; quote_link: no field named, so off). Each field must be on the writer allow-list (writeMap.ts); figures are never written. stageRank orders Salesforce stages for the regression check. Provisional until the Salesforce owner approves the fields and stages.'),
  ('sf_writeback_stage_regression', '"skip"', 'FB-29: skip = never move an opportunity to an earlier stage (by stageRank) than the one Salesforce holds, since a sales person may have moved it further; allow = write anyway. A reopen after a re-quote is exempt. Provisional.'),
  ('sf_writeback_max_attempts', '5', 'FB-29: tries before a write is marked failed and every Admin is told once. Provisional.'),
  ('sf_writeback_retry_minutes', '[1,5,30,120,360]', 'FB-29: minutes to wait after the 1st, 2nd, ... failed try (the last repeats): 1, 5, 30, 120, 360. Provisional.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;
