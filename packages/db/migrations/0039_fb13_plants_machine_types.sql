-- FB-13 (Plants and machine types). Tracker: F-057 (the plant list and machine types FB-09 was waiting for).
-- Source: Jim Zweifel's "QuoteFlow Plants and Process.xlsx" of 2026-11-10, confirmed correct by Ben Whann
-- (docs/build-guide/feedback/inputs/plants-machine-types.md). Loaded exactly as sent: 22 locations, 14 machine
-- types; nothing is questioned or "fixed" ("12B" at St. Charles and "Etten.Leur" are as sent).
-- Data only: no schema change. Each plant carries its machine-type codes in meta.machineTypes (data, not code).
--
-- The config seed refreshes only untouched rows (version = 1) at start-up, so the statements below carry the
-- change to existing environments. On a fresh database the config tables are empty here: each statement is a
-- no-op and the seed inserts the same values. A row the business approved, or one an Admin edited (version > 1),
-- is never changed (a plant or machine type that already has one of these codes is left as it is); the report
-- (pnpm --filter @ccq/db fb09:report) lists the quotes still on a retired code and any placeholder that was
-- skipped. Nothing is deleted and no quote is remapped: a quote on a retired code keeps it and shows
-- "(no longer offered)" (as for EBM_WHEEL, FB-03, the retired resins, FB-09, and the old markets, FB-12).
-- approved_by is a user id and Jim Zweifel is not an app user, so his name is kept in meta.approvedByName.
-- Idempotent and safe to re-run.
--
-- 1. Plants: Jim's 22 locations, in his order, approved.
-- fb13-plants:start
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional", "approved_at")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'plant', v.code, v.label, v.sort, true, v.meta::jsonb, false, '2026-11-10T00:00:00Z'::timestamptz
FROM (VALUES
  ('AURORA', 'Aurora', 10, '{"machineTypes":["EBM"],"approvedByName":"Jim Zweifel"}'),
  ('BETHLEHEM', 'Bethlehem', 20, '{"machineTypes":["EBM","IBM","ISBM"],"approvedByName":"Jim Zweifel"}'),
  ('BOXMORE', 'Boxmore', 30, '{"machineTypes":["EBM","IBM","INJ-CAP","PAD PRINTING"],"approvedByName":"Jim Zweifel"}'),
  ('CARROLLTON', 'Carrollton', 40, '{"machineTypes":["EBM","ISBM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('CLEVELAND_OH', 'Cleveland, OH', 50, '{"machineTypes":["EBM","INJ-PREFORM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('CLEVELAND_TN', 'Cleveland, TN', 60, '{"machineTypes":["IBM","INJ-OTHER"],"approvedByName":"Jim Zweifel"}'),
  ('LERMA_EDIPLAST', 'Lerma, Ediplast', 70, '{"machineTypes":["EBM","INJ-PREFORM","ISBM","RHB","DECO"],"approvedByName":"Jim Zweifel"}'),
  ('LERMA_EDIPRINT', 'Lerma, Ediprint', 80, '{"machineTypes":["DIE CUTTING","LAMINATION","PRINTING","STAMPING"],"approvedByName":"Jim Zweifel"}'),
  ('ETTEN_LEUR', 'Etten.Leur', 90, '{"machineTypes":["ISBM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('GREENSBORO', 'Greensboro', 100, '{"machineTypes":["EBM"],"approvedByName":"Jim Zweifel"}'),
  ('HAZLETON', 'Hazleton', 110, '{"machineTypes":["ISBM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('HILLSBOROUGH', 'Hillsborough', 120, '{"machineTypes":["IBM","ISBM","INJ-CAP","INJ-OTHER"],"approvedByName":"Jim Zweifel"}'),
  ('LEIPSIC', 'Leipsic', 130, '{"machineTypes":["EBM"],"approvedByName":"Jim Zweifel"}'),
  ('MANCHESTER', 'Manchester', 140, '{"machineTypes":["EBM","ISBM"],"approvedByName":"Jim Zweifel"}'),
  ('PERU', 'Peru', 150, '{"machineTypes":["ISBM"],"approvedByName":"Jim Zweifel"}'),
  ('SALT_LAKE_CITY', 'Salt Lake City', 160, '{"machineTypes":["EBM","IBM","ISBM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('ST_CHARLES', 'St. Charles', 170, '{"machineTypes":["12B","INJ-CAP","ISBM","RHB","DECO"],"approvedByName":"Jim Zweifel"}'),
  ('ST_LAURENT', 'St. Laurent', 180, '{"machineTypes":["EBM","IBM"],"approvedByName":"Jim Zweifel"}'),
  ('ST_LOUIS', 'St. Louis', 190, '{"machineTypes":["IBM","INJ-CAP","ISBM"],"approvedByName":"Jim Zweifel"}'),
  ('TORONTO', 'Toronto', 200, '{"machineTypes":["EBM","IBM","INJ-OTHER"],"approvedByName":"Jim Zweifel"}'),
  ('TROY', 'Troy', 210, '{"machineTypes":["EBM","RHB"],"approvedByName":"Jim Zweifel"}'),
  ('VANCOUVER', 'Vancouver', 220, '{"machineTypes":["EBM","IBM","ISBM"],"approvedByName":"Jim Zweifel"}')
) AS v(code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list" WHERE "list_key" = 'plant')
ON CONFLICT ("list_key", "code") DO NOTHING;
--> statement-breakpoint
-- 2. Machine types: Jim's 14 codes, in his order, labels as sent, approved.
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional", "approved_at")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'machine_type', v.code, v.label, v.sort, true, v.meta::jsonb, false, '2026-11-10T00:00:00Z'::timestamptz
FROM (VALUES
  ('EBM', 'EBM', 10, '{"approvedByName":"Jim Zweifel"}'),
  ('IBM', 'IBM', 20, '{"approvedByName":"Jim Zweifel"}'),
  ('ISBM', 'ISBM', 30, '{"approvedByName":"Jim Zweifel"}'),
  ('RHB', 'RHB', 40, '{"approvedByName":"Jim Zweifel"}'),
  ('INJ-CAP', 'INJ - CAP', 50, '{"approvedByName":"Jim Zweifel"}'),
  ('INJ-PREFORM', 'INJ - PREFORM', 60, '{"approvedByName":"Jim Zweifel"}'),
  ('INJ-OTHER', 'INJ - OTHER', 70, '{"approvedByName":"Jim Zweifel"}'),
  ('DECO', 'DECO', 80, '{"approvedByName":"Jim Zweifel"}'),
  ('PAD PRINTING', 'PAD PRINTING', 90, '{"approvedByName":"Jim Zweifel"}'),
  ('12B', '12B', 100, '{"approvedByName":"Jim Zweifel"}'),
  ('DIE CUTTING', 'DIE CUTTING', 110, '{"approvedByName":"Jim Zweifel"}'),
  ('LAMINATION', 'LAMINATION', 120, '{"approvedByName":"Jim Zweifel"}'),
  ('PRINTING', 'PRINTING', 130, '{"approvedByName":"Jim Zweifel"}'),
  ('STAMPING', 'STAMPING', 140, '{"approvedByName":"Jim Zweifel"}')
) AS v(code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list" WHERE "list_key" = 'machine_type')
ON CONFLICT ("list_key", "code") DO NOTHING;
--> statement-breakpoint
-- 3. Retire the placeholders (kept, inactive): PLANT_01 to PLANT_03 and the old machine types. EBM_WHEEL has
--    been inactive since FB-03 (see the last statement). A row an Admin edited or the business approved stays.
UPDATE "value_list"
  SET "active" = false, "sort" = 900 + "sort", "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'plant' AND "code" IN ('PLANT_01', 'PLANT_02', 'PLANT_03')
    AND "active" AND "provisional" AND "approved_at" IS NULL AND "version" = 1;
--> statement-breakpoint
UPDATE "value_list"
  SET "active" = false, "sort" = 900 + "sort", "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'machine_type'
    AND "code" IN ('EBM_SHUTTLE', 'EBM_WHEEL', 'IBM_PRESS', 'ISBM_1STEP', 'ISBM_2STEP', 'INJECTION_PRESS', 'OTHER')
    AND "active" AND "provisional" AND "approved_at" IS NULL AND "version" = 1;
--> statement-breakpoint
-- EBM_WHEEL is already inactive: only move it below the new values so the console lists it with the other
-- retired types (no version bump, nothing else changes).
UPDATE "value_list"
  SET "sort" = 900 + "sort", "updated_at" = now()
  WHERE "list_key" = 'machine_type' AND "code" = 'EBM_WHEEL'
    AND NOT "active" AND "provisional" AND "approved_at" IS NULL AND "sort" < 900;
-- fb13-plants:end
