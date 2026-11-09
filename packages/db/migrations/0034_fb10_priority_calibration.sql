ALTER TABLE "quote" ADD COLUMN "guardrail_warning" text;--> statement-breakpoint
-- FB-10 (Priority calibration). Tracker: F-005 (weights), F-073 (points), F-066 (P1), T-011, T-025, T-036;
-- decision D-004 (OPEN). Schema: one nullable text column on "quote" (the platform-minimum warning kept for
-- G1). Data, all PROVISIONAL and INACTIVE: nothing here changes how a live quote is scored or routed.
--
-- 1. A DRAFT scoring model (no effective_from, so it scores nothing) copied from the model in effect, with
--    strategic fit scored by market from the Where-to-Play 9-box (provisional points; placement unconfirmed:
--    docs/build-guide/feedback/inputs/9-box.md). Weights, tiers and every other attribute are the active
--    model's. Skipped when a draft already exists, when an FB-10 draft was made before (an Admin who
--    discarded or activated it is not given another), or when the active model already has strategic-fit
--    points (an Admin's own). An Admin compares it in the preview, then activates it.
-- 2. g1_volume_routing (T-011), seeded OFF; intake_guardrails (F-066), seeded OFF.
-- fb10-config:start
INSERT INTO "scoring_model" (
  "id", "created_at", "updated_at", "provisional", "model_version", "attributes", "tier_thresholds",
  "effective_from", "change_reason"
)
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid,
  now(),
  now(),
  true,
  (SELECT max("model_version") + 1 FROM "scoring_model"),
  (
    SELECT jsonb_agg(
      CASE WHEN a.e->>'key' = 'strategic_fit'
        THEN jsonb_set(a.e, '{map}', (a.e->'map') || jsonb_build_object('values',
          '{"PERSONAL_CARE":90,"NUTRITION":75,"FOOD":75,"PET":75,"BEVERAGE":60,"HOUSEHOLD_CHEMICAL":50,"INDUSTRIAL_CHEMICAL":50,"PHARMA_HEALTH":20}'::jsonb))
        ELSE a.e END
      ORDER BY a.i)
    FROM jsonb_array_elements(m."attributes") WITH ORDINALITY AS a(e, i)
  ),
  m."tier_thresholds",
  NULL,
  'FB-10 (F-073, D-004 open): DRAFT. Weights and tiers equal the active model. Strategic fit scores by market from the Where-to-Play 9-box (provisional points; the cell placement is unconfirmed, see feedback/inputs/9-box.md). Not active: compare it in the preview, then activate once D-004 is decided.'
FROM "scoring_model" m
WHERE m."effective_from" IS NOT NULL AND m."effective_from" <= now()
  AND m."model_version" = (
    SELECT max("model_version") FROM "scoring_model"
    WHERE "effective_from" IS NOT NULL AND "effective_from" <= now()
  )
  AND NOT EXISTS (SELECT 1 FROM "scoring_model" WHERE "effective_from" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "scoring_model" WHERE "change_reason" LIKE 'FB-10%')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(m."attributes") AS a(e)
    WHERE a.e->>'key' = 'strategic_fit' AND a.e->'map' IS NOT NULL
      AND coalesce(a.e->'map'->'values', '{}'::jsonb) = '{}'::jsonb
  );
--> statement-breakpoint
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'g1_volume_routing',
  '{"enabled":false,"metric":"est_annual_volume","min":1000000,"max":null}'::jsonb,
  'FB-10 (T-011, D-004 open): volume-band routing at intake, seeded OFF. When enabled, a submitted quote whose metric (est_annual_volume or est_annual_revenue) is outside [min, max) goes to the sales leader to qualify (G1); one inside the band goes straight to Engineering (SUBMIT). A missing value goes to the sales leader. It replaces g1_enabled for the submit, so G1 must be on to switch it on. The tracker words T-011 as revenue bands; the platform guide gives volumes, so the metric is a setting. Seed: min 1,000,000 units (the lowest platform minimum), no maximum. Provisional until D-004 sets the band.',
  true
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'intake_guardrails',
  '{"enabled":false,"minAnnualVolumeByProcess":{"ISBM":3000000,"RHB":1000000,"IMM":1000000,"IBM":3000000,"EBM":1000000},"unknownPlatformLabel":"our machine platforms","message":"Below the platform minimum for {platform}: {units} units/yr. You can still submit."}'::jsonb,
  'FB-10 (F-066, T-025, D-004 open): non-blocking platform-minimum warning at intake, seeded OFF until Danielle Leu confirms the column mapping of the machine platform guide. minAnnualVolumeByProcess = new-mold planning minimum (units/yr) by process_type; while the platform is not known the lowest minimum applies. The warning is shown on the intake and kept on the quote for G1; it never blocks a submit.',
  true
)
ON CONFLICT ("key") DO NOTHING;
-- fb10-config:end
