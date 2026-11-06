-- FB-04 (Qualification, funding wording and the Salesforce link). Tracker: F-065 (D-028), F-022 (D-023),
-- V-055 (D-003 open), F-076, F-073 (mechanism only), F-005 (test only). Data changes only: no schema change.
--
-- 1. F-065 / D-028: only a SalesLeader overrides the priority tier, self-applied with a justification
--    (the 15-character minimum stays). KAM, EngLead and Pricing are no longer requesters. Requests that
--    were already waiting are NOT rejected: the SalesLeader decides them (planOverrideDecision).
-- 2. F-022 / D-023: "$0 CER" is relabelled and gets help text; V-055: "Shared" is added (provisional, D-003).
-- 3. F-076: settings salesforce_instance_url (seeded empty) and sf_outcome_stage_names (provisional).

UPDATE "app_setting"
  SET "value" = (
        SELECT jsonb_agg(
          CASE WHEN f.e->>'field' = 'priority_tier'
            THEN f.e || '{"approval":"self","requestRoles":["SalesLeader"],"approverRoles":[]}'::jsonb
            ELSE f.e END
          ORDER BY f.i)
        FROM jsonb_array_elements("app_setting"."value") WITH ORDINALITY AS f(e, i)
      ),
      "version" = "version" + 1,
      "updated_at" = now()
  WHERE "key" = 'overridable_fields'
    AND jsonb_typeof("value") = 'array'
    AND "value" @> '[{"field":"priority_tier"}]'::jsonb;--> statement-breakpoint

UPDATE "value_list"
  SET "label" = '$0 CER (customer-reimbursed capital)',
      "meta" = "meta" || jsonb_build_object('helpText', 'Follows the standard quoting process. The capital is reimbursed by the customer as a lump sum or through amortization, and is approved after award like company-funded capital. At purchasing, the customer invoice or contract goes with the mold PO.'),
      "version" = "version" + 1,
      "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'ZERO_CER';--> statement-breakpoint

INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'tooling_funding_model', 'SHARED', 'Shared (company and customer)', 50, true,
  jsonb_build_object('helpText', 'Split agreed with the customer; record the split in the terms notes until the terms structure is decided (D-003).'),
  true
)
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint

INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'salesforce_instance_url',
  '""'::jsonb,
  'FB-04 (F-076): the Salesforce Lightning base URL, e.g. https://pretium.lightning.force.com (not a secret). Empty: the quote header shows the plain opportunity ID. Set by an Admin; the Salesforce connection itself only knows a login URL.',
  true
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'sf_outcome_stage_names',
  '{"awarded":"Verbal Award","negotiating":"Negotiating","lost":"Closed Lost","expired":"Closed Lost","requote":"Quoting"}'::jsonb,
  'FB-04 (F-076): the Salesforce stage named in the reminder shown after a G5 outcome is saved (CCQ outcome key to a name in sf_stage_map). Nothing is written to Salesforce. Provisional until the KAMs confirm which stage they use.',
  true
)
ON CONFLICT ("key") DO NOTHING;
