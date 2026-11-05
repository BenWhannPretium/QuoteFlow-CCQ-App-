-- FB-03 (Engineering review and capacity). Tracker: F-059, F-061, F-064, F-057 (part), F-023.
--
-- 1. F-059: "buffer" is replaced by utilization before and after. buffer_pct and utilization_pct are
--    DEPRECATED, not dropped (history and Fabric keep them); utilization_pct's values move into the new
--    utilization_before_pct. utilization_after_pct is calculated by the server (capacity.ts) and stored.
-- 2. F-061: attachment kind capacity_analysis.
-- 3. F-064: handoff_record gets the "Ready for CER development" tick (who and when).
-- 4. F-057: cavitation is a whole number 1-99 (NOT VALID: existing rows over 99 are not rejected);
--    the EBM wheel machine type is deactivated (existing quotes keep it).
-- 5. Setting capacity_basis (provisional, D-021).

ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "capacity_evidence" DROP CONSTRAINT "capacity_evidence_pct_check";--> statement-breakpoint
ALTER TABLE "eng_review" DROP CONSTRAINT "eng_review_cavitation_check";--> statement-breakpoint
ALTER TABLE "capacity_evidence" ALTER COLUMN "utilization_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD COLUMN "utilization_before_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD COLUMN "allocated_annual_volume" bigint;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD COLUMN "scheduled_run_days_per_year" integer;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD COLUMN "utilization_after_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "cer_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "cer_ready_by" uuid;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_cer_ready_by_app_user_id_fk" FOREIGN KEY ("cer_ready_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- F-059 backfill. Before = the old typed utilization. Allocated volume = the quote's estimated annual
-- volume, run days = 350 (the provisional capacity_basis default). After = before + allocated / annual
-- capacity, with OEE applied once: (86400 / cycle) x cavitation x (OEE / 100) x run days. It stays null
-- when an input is missing (no cavitation yet, no volume, zero OEE or cycle time).
UPDATE "capacity_evidence" ce SET
    "utilization_before_pct" = ce."utilization_pct",
    "allocated_annual_volume" = q."est_annual_volume",
    "scheduled_run_days_per_year" = 350
  FROM "quote" q
  WHERE q."id" = ce."quote_id";--> statement-breakpoint
UPDATE "capacity_evidence" SET "utilization_before_pct" = COALESCE("utilization_pct", 0)
  WHERE "utilization_before_pct" IS NULL;--> statement-breakpoint
UPDATE "capacity_evidence" ce SET
    "utilization_after_pct" = LEAST(
      99999.99,
      round(
        ce."utilization_before_pct"
        + ce."allocated_annual_volume"::numeric * 100
          / ((86400 / ce."cycle_time_s") * er."cavitation" * (ce."assumed_effectiveness_pct" / 100) * ce."scheduled_run_days_per_year"),
        2
      )
    )
  FROM "eng_review" er
  WHERE er."quote_id" = ce."quote_id"
    AND er."cavitation" > 0
    AND ce."cycle_time_s" > 0
    AND ce."assumed_effectiveness_pct" > 0
    AND ce."allocated_annual_volume" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ALTER COLUMN "utilization_before_pct" SET NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "capacity_evidence"."buffer_pct" IS 'DEPRECATED (FB-03, F-059): "buffer" was defined three different ways by Engineering. Kept for history and Fabric; no longer written or shown.';--> statement-breakpoint
COMMENT ON COLUMN "capacity_evidence"."utilization_pct" IS 'DEPRECATED (FB-03, F-059): replaced by utilization_before_pct (values copied). Kept for history and Fabric; no longer written.';--> statement-breakpoint

ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other'));--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_utilization_check" CHECK ("capacity_evidence"."utilization_before_pct" between 0 and 100 and ("capacity_evidence"."allocated_annual_volume" is null or "capacity_evidence"."allocated_annual_volume" >= 0) and ("capacity_evidence"."scheduled_run_days_per_year" is null or "capacity_evidence"."scheduled_run_days_per_year" between 1 and 366) and ("capacity_evidence"."utilization_after_pct" is null or "capacity_evidence"."utilization_after_pct" >= 0));--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_pct_check" CHECK ("capacity_evidence"."assumed_effectiveness_pct" between 0 and 100 and ("capacity_evidence"."utilization_pct" is null or "capacity_evidence"."utilization_pct" between 0 and 100) and ("capacity_evidence"."buffer_pct" is null or "capacity_evidence"."buffer_pct" between 0 and 100));--> statement-breakpoint
-- NOT VALID: rows already over 99 are left alone; every new write is checked.
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_cavitation_check" CHECK ("eng_review"."cavitation" between 1 and 99) NOT VALID;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_cer_ready_consistency_check" CHECK (("handoff_record"."cer_ready_at" is null) = ("handoff_record"."cer_ready_by" is null));--> statement-breakpoint

-- F-057: nobody can pick the EBM wheel any more; existing quotes keep and show it. `version` is bumped so a
-- re-seed (which only refreshes untouched rows) never switches it back on.
UPDATE "value_list" SET "active" = false, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'machine_type' AND "code" = 'EBM_WHEEL' AND "active";--> statement-breakpoint

-- F-064: the G2 "Capital required" help names the budgetary estimate. Only text still at the seed wording is
-- changed (an Admin's own edit is left alone); the seed carries the same wording.
UPDATE "gate_outcome_definition"
  SET "help_text" = replace("help_text", 'Record the preliminary capital estimate; Pricing', 'Record the budgetary capital estimate (preliminary, includes contingency); Pricing'),
      "updated_at" = now()
  WHERE "gate_key" = 'G2' AND "key" = 'capital_required'
    AND "help_text" LIKE '%Record the preliminary capital estimate; Pricing%';--> statement-breakpoint

-- F-059 / D-021: the provisional capacity basis. The UUID is a v7 built from the clock.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'capacity_basis',
  '{"scheduledRunDaysPerYear": 350, "warnAbovePct": 85, "basisLabel": "Trailing 12 months actual, trending OEE (provisional, D-021)"}'::jsonb,
  'FB-03 / D-021 (open): the basis for utilization after the new business. scheduledRunDaysPerYear defaults each capacity row; warnAbovePct turns the after-utilization amber (over 100 is always red); basisLabel is shown under the capacity table and in the CSV. Provisional until Faron Ipox and leadership confirm the basis (A-023).',
  true
)
ON CONFLICT ("key") DO NOTHING;
