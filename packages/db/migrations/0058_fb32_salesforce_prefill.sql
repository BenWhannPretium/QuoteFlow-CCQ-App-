-- FB-32 (N19-04, Sarah Brennan): less double entry. Data only: no schema object is added, changed or
-- dropped, nothing is truncated. Config follows 0044 / 0049 / 0051 / 0056: a row that exists is left alone
-- (an Admin's edit and the business's approval both win). On a fresh database the config tables are empty
-- here, so the statement is a no-op and the seed inserts the same value. Safe to re-run.
--
-- intake_sf_suggestions_enabled: provisional, OFF. When on, the intake shows "Salesforce says X, Use this"
-- under a question whose Salesforce field has no confirmed meaning (the specification's Color, under
-- Color), for an exact list match only. Nothing is filled automatically; nothing is written to Salesforce.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, s.key, s.value::jsonb, s.description, true
FROM (VALUES
  ('intake_sf_suggestions_enabled', 'false',
   'FB-32 (N19-04, Sarah Brennan): when on, the intake shows a one-line hint, "Salesforce says X" with a Use this button, under a question whose Salesforce field has no confirmed meaning (today the Color field of the opportunity product specification, under Color). The hint appears only when the Salesforce text equals an entry of the question list exactly (ignoring case and spaces); nothing is filled automatically and nothing is written to Salesforce. Provisional, off, until Zachary Cairns confirms what the field means.')
) AS s(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;
