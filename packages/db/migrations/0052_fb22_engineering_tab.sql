ALTER TABLE "eng_review" ADD COLUMN "machine_platform" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capacity_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capacity_submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_capacity_submitted_by_app_user_id_fk" FOREIGN KEY ("capacity_submitted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_machine_platform_check" CHECK ("eng_review"."machine_platform" is null or char_length("eng_review"."machine_platform") <= 80);--> statement-breakpoint
-- ── FB-22 (hand-written): the Engineering tab ────────────────────────────────────────────────────────
-- Feedback N17-12, N17-13, N17-14 (Ben Whann, Bailey Schmitt, Jim Zweifel; walkthrough and demo of
-- 2026-11-17, sync of 2026-11-18). Synthetic data only.
--
-- The statements above add the production scheduler's own submission to the engineering lead
-- (quote.capacity_submitted_at / _by) and the machine platform (eng_review.machine_platform, text up to 80).
-- timestamptz, uuid and text only: nothing for the Fabric companions (rule 10). Technical concept and Supply
-- chain (eng_review.technical_concept_notes, supply_chain_notes) are deprecated, not dropped: the form no
-- longer asks for them and old values stay readable.
--
-- As 0031 / 0046 / 0049: on a fresh database the config tables are empty here, so the setting insert is a
-- no-op and the seed inserts the same row. Every statement is safe to re-run.
--
-- 1. When the engineering lead is told (provisional; seed both_parts).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'eng_lead_notify_when', '"both_parts"'::jsonb,
  'FB-22 (N17-14): when the engineering lead is told a quote is ready for review. both_parts: once the engineer and the production scheduler have both submitted their parts (or the engineer alone, when no scheduler is assigned; or the scheduler alone, when the engineer is an engineering lead). each_part: on each submission. Either way the quote reads "Ready for lead review" only once every part is in, and the lead may decide at any time. Seed: both_parts. Provisional.',
  true
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- 2. An open quote in Engineering that the engineer already submitted while a production scheduler was
-- assigned: before FB-22 that one submission covered the capacity rows too, so it stays "Ready for lead
-- review". The scheduler's part is marked in at the same time, with no submitter (nobody pressed it). Each
-- change gets an audit row by the system (no actor), in the same statement.
WITH updated AS (
  UPDATE "quote" q
  SET "capacity_submitted_at" = q."eng_submitted_at", "updated_at" = now()
  WHERE q."stage_key" = 'ENG_REVIEW' AND q."status" <> 'closed'
    AND q."eng_submitted_at" IS NOT NULL AND q."assigned_scheduler_id" IS NOT NULL
    AND q."capacity_submitted_at" IS NULL
  RETURNING q."id", q."capacity_submitted_at"
)
INSERT INTO "audit_event" (
  "id", "at", "actor_id", "action", "entity", "entity_id", "quote_id", "before", "after",
  "change_reason")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, now(), NULL, 'update', 'quote', u."id"::text, u."id",
  '{"capacitySubmittedAt":null}'::jsonb,
  jsonb_build_object(
    'capacitySubmittedAt', u."capacity_submitted_at",
    'source', 'migration:0052_fb22_engineering_tab'),
  'FB-22 (N17-14): the engineer''s submission covered the capacity part before the scheduler could submit their own'
FROM updated u;
