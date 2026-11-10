-- Platform-minimum seed correction (follow-up to FB-10). Tracker: F-066, T-025, A-010; decision D-004 (OPEN).
-- Danielle Leu corrected our read of the Machine Platforms guide on 2026-11-09 (reply to "QuoteFlow: please
-- confirm our read of the Machine Platforms guide by Thursday"). FB-10 (0034) seeded ISBM 3M and Injection
-- (IMM) 1M; her table has ISBM 1M and Injection 3M. RHB 1M, IBM 3M and EBM 1M are unchanged.
--
-- Data only, no schema change. It corrects "intake_guardrails" only while the row still holds exactly the
-- FB-10 seed: provisional, unapproved, never edited in the console (version = 1) and the FB-10 minimums.
-- An Admin's own minimums are left alone. "enabled" is not touched (the warning stays OFF until D-004).
-- Idempotent: once corrected, the row no longer matches.
-- fb10-platform-minimums:start
UPDATE "app_setting"
SET
  "value" = jsonb_set("value", '{minAnnualVolumeByProcess}', '{"ISBM":1000000,"RHB":1000000,"IMM":3000000,"IBM":3000000,"EBM":1000000}'::jsonb),
  "description" = 'FB-10 (F-066, T-025, D-004 open): non-blocking platform-minimum warning at intake, seeded OFF. minAnnualVolumeByProcess = new-mold planning minimum (units/yr) by process_type, from Danielle Leu’s corrected Machine Platforms table (2026-11-09): ISBM 1M, RHB 1M, Injection (IMM) 3M, IBM 3M, EBM 1M. While the platform is not known the lowest minimum applies. The warning is shown on the intake and kept on the quote for G1; it never blocks a submit. An Admin switches it on once D-004 agrees to warn at these volumes.',
  "updated_at" = now()
WHERE "key" = 'intake_guardrails'
  AND "provisional" = true
  AND "approved_at" IS NULL
  AND "version" = 1
  AND "value"->'minAnnualVolumeByProcess' = '{"ISBM":3000000,"RHB":1000000,"IMM":1000000,"IBM":3000000,"EBM":1000000}'::jsonb;
-- fb10-platform-minimums:end
