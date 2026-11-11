-- DR-engineering-05 (AI dry-run UAT): the engineering assignment suggestion sent injection (IMM) to the PET
-- engineer but not IMM Preform, which is in the process-type list. The seed rule now lists IMM_PREFORM too.
-- Data only: no schema change. Only the first rule as seeded by FB-06 (process types exactly ISBM, RHB, IMM, for
-- the PET engineer) of a setting nobody approved is changed; an Admin's own edit is left alone (add IMM_PREFORM
-- by hand in Admin -> App settings). Idempotent.
UPDATE "app_setting"
SET "value" = jsonb_set(
      jsonb_set("value", '{rules,0,processTypes}', '["ISBM","RHB","IMM","IMM_PREFORM"]'::jsonb),
      '{rules,0,note}',
      '"Paul Slomkowski, Nov 4: ISBM, RHB and injection (IMM, IMM Preform) go to the PET engineer."'::jsonb),
    "updated_at" = now()
WHERE "key" = 'engineering_assignment_rules' AND "approved_at" IS NULL
  AND "value" #> '{rules,0,processTypes}' = '["ISBM","RHB","IMM"]'::jsonb
  AND "value" #>> '{rules,0,engineerName}' = 'Neiberger';
