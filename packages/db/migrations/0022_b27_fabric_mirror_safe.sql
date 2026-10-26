-- B-27 (L-8): make the schema mirror-safe for Fabric mirroring. Registry and rules: src/fabric.ts.
--
-- 1. pricing_history_record figures: an unbounded numeric lands in Fabric as Decimal(38, 0) (decimals
--    lost), so bound them at numeric(38, 4). Junk values of 1e30 and more become null first (the raw
--    value stays in `fields`; the importer drops them from now on).
UPDATE "pricing_history_record" SET "est_revenue_usd" = NULL WHERE abs("est_revenue_usd") >= 1e30;
--> statement-breakpoint
UPDATE "pricing_history_record" SET "est_volume" = NULL WHERE abs("est_volume") >= 1e30;
--> statement-breakpoint
CREATE TABLE "audit_event_fabric" (
	"audit_event_id" uuid PRIMARY KEY NOT NULL,
	"actor_roles_json" text,
	"before_json" text,
	"after_json" text
);
--> statement-breakpoint
ALTER TABLE "integration_run" DROP CONSTRAINT "integration_run_source_check";--> statement-breakpoint
ALTER TABLE "pricing_history_record" ALTER COLUMN "est_revenue_usd" SET DATA TYPE numeric(38, 4);--> statement-breakpoint
ALTER TABLE "pricing_history_record" ALTER COLUMN "est_volume" SET DATA TYPE numeric(38, 4);--> statement-breakpoint
ALTER TABLE "audit_event_fabric" ADD CONSTRAINT "audit_event_fabric_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_run" ADD CONSTRAINT "integration_run_source_check" CHECK ("integration_run"."source" in ('salesforce', 'pricing', 'sharepoint', 'fabric'));
--> statement-breakpoint

-- 2. Text companions. Fabric doesn't mirror jsonb or array columns, so each gets `<column>_json text`
--    = to_jsonb(<column>)::text (arrays as JSON arrays), kept in step by one generic BEFORE trigger.
--    A trigger, not a generated column: PostgreSQL 16 logical replication doesn't publish generated
--    columns. The companions are not in the Drizzle schema: the app never reads or writes them.
CREATE OR REPLACE FUNCTION fabric_json_companions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col text;
  copy text;
  patch jsonb := '{}'::jsonb;
BEGIN
  -- TG_ARGV: the source columns; each companion is the column name + '_json'.
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT to_jsonb(($1).%I)::text', col) INTO copy USING NEW;
    patch := patch || jsonb_build_object(col || '_json', copy);
  END LOOP;
  RETURN jsonb_populate_record(NEW, patch);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION fabric_json_companions() IS 'B-27: keeps each <column>_json text companion equal to to_jsonb(<column>)::text, for Fabric mirroring (which drops jsonb and array columns).';
--> statement-breakpoint
ALTER TABLE "activity_event"
  ADD COLUMN "payload_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "activity_event"."payload_json" IS 'Fabric copy of payload as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "activity_event"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('payload');
--> statement-breakpoint
UPDATE "activity_event" SET
    "payload_json" = to_jsonb("payload")::text
  WHERE "payload" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_setting"
  ADD COLUMN "value_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "app_setting"."value_json" IS 'Fabric copy of value as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "app_setting"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('value');
--> statement-breakpoint
UPDATE "app_setting" SET
    "value_json" = to_jsonb("value")::text
  WHERE "value" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "comment"
  ADD COLUMN "mentions_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "comment"."mentions_json" IS 'Fabric copy of mentions as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "comment"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('mentions');
--> statement-breakpoint
UPDATE "comment" SET
    "mentions_json" = to_jsonb("mentions")::text
  WHERE "mentions" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer"
  ADD COLUMN "default_ship_to_json" text,
  ADD COLUMN "contact_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "customer"."default_ship_to_json" IS 'Fabric copy of default_ship_to as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "customer"."contact_json" IS 'Fabric copy of contact as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "customer"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('default_ship_to', 'contact');
--> statement-breakpoint
UPDATE "customer" SET
    "default_ship_to_json" = to_jsonb("default_ship_to")::text,
    "contact_json" = to_jsonb("contact")::text
  WHERE "default_ship_to" IS NOT NULL OR "contact" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "gate_decision"
  ADD COLUMN "evidence_json" text,
  ADD COLUMN "payload_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "gate_decision"."evidence_json" IS 'Fabric copy of evidence as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "gate_decision"."payload_json" IS 'Fabric copy of payload as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "gate_decision"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('evidence', 'payload');
--> statement-breakpoint
UPDATE "gate_decision" SET
    "evidence_json" = to_jsonb("evidence")::text,
    "payload_json" = to_jsonb("payload")::text
  WHERE "evidence" IS NOT NULL OR "payload" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "gate_definition"
  ADD COLUMN "required_fields_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "gate_definition"."required_fields_json" IS 'Fabric copy of required_fields as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "gate_definition"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('required_fields');
--> statement-breakpoint
UPDATE "gate_definition" SET
    "required_fields_json" = to_jsonb("required_fields")::text
  WHERE "required_fields" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "gate_outcome_definition"
  ADD COLUMN "required_fields_json" text,
  ADD COLUMN "notify_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "gate_outcome_definition"."required_fields_json" IS 'Fabric copy of required_fields as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "gate_outcome_definition"."notify_json" IS 'Fabric copy of notify as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "gate_outcome_definition"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('required_fields', 'notify');
--> statement-breakpoint
UPDATE "gate_outcome_definition" SET
    "required_fields_json" = to_jsonb("required_fields")::text,
    "notify_json" = to_jsonb("notify")::text
  WHERE "required_fields" IS NOT NULL OR "notify" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_run"
  ADD COLUMN "counts_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "integration_run"."counts_json" IS 'Fabric copy of counts as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "integration_run"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('counts');
--> statement-breakpoint
UPDATE "integration_run" SET
    "counts_json" = to_jsonb("counts")::text
  WHERE "counts" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification"
  ADD COLUMN "payload_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "notification"."payload_json" IS 'Fabric copy of payload as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "notification"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('payload');
--> statement-breakpoint
UPDATE "notification" SET
    "payload_json" = to_jsonb("payload")::text
  WHERE "payload" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "override"
  ADD COLUMN "original_value_json" text,
  ADD COLUMN "requested_value_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "override"."original_value_json" IS 'Fabric copy of original_value as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "override"."requested_value_json" IS 'Fabric copy of requested_value as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "override"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('original_value', 'requested_value');
--> statement-breakpoint
UPDATE "override" SET
    "original_value_json" = to_jsonb("original_value")::text,
    "requested_value_json" = to_jsonb("requested_value")::text
  WHERE "original_value" IS NOT NULL OR "requested_value" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pricing_history_record"
  ADD COLUMN "fields_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "pricing_history_record"."fields_json" IS 'Fabric copy of fields as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "pricing_history_record"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('fields');
--> statement-breakpoint
UPDATE "pricing_history_record" SET
    "fields_json" = to_jsonb("fields")::text
  WHERE "fields" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pricing_record"
  ADD COLUMN "pricing_refs_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "pricing_record"."pricing_refs_json" IS 'Fabric copy of pricing_refs as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "pricing_record"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('pricing_refs');
--> statement-breakpoint
UPDATE "pricing_record" SET
    "pricing_refs_json" = to_jsonb("pricing_refs")::text
  WHERE "pricing_refs" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote"
  ADD COLUMN "components_json" text,
  ADD COLUMN "priority_breakdown_json" text,
  ADD COLUMN "ship_to_json" text,
  ADD COLUMN "ship_to_original_json" text,
  ADD COLUMN "structured_description_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "quote"."components_json" IS 'Fabric copy of components as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "quote"."priority_breakdown_json" IS 'Fabric copy of priority_breakdown as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "quote"."ship_to_json" IS 'Fabric copy of ship_to as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "quote"."ship_to_original_json" IS 'Fabric copy of ship_to_original as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "quote"."structured_description_json" IS 'Fabric copy of structured_description as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('components', 'priority_breakdown', 'ship_to', 'ship_to_original', 'structured_description');
--> statement-breakpoint
UPDATE "quote" SET
    "components_json" = to_jsonb("components")::text,
    "priority_breakdown_json" = to_jsonb("priority_breakdown")::text,
    "ship_to_json" = to_jsonb("ship_to")::text,
    "ship_to_original_json" = to_jsonb("ship_to_original")::text,
    "structured_description_json" = to_jsonb("structured_description")::text
  WHERE "components" IS NOT NULL OR "priority_breakdown" IS NOT NULL OR "ship_to" IS NOT NULL OR "ship_to_original" IS NOT NULL OR "structured_description" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_draft"
  ADD COLUMN "data_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "quote_draft"."data_json" IS 'Fabric copy of data as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "quote_draft"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('data');
--> statement-breakpoint
UPDATE "quote_draft" SET
    "data_json" = to_jsonb("data")::text
  WHERE "data" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "role_permission"
  ADD COLUMN "qualifier_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "role_permission"."qualifier_json" IS 'Fabric copy of qualifier as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "role_permission"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('qualifier');
--> statement-breakpoint
UPDATE "role_permission" SET
    "qualifier_json" = to_jsonb("qualifier")::text
  WHERE "qualifier" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "scoring_model"
  ADD COLUMN "attributes_json" text,
  ADD COLUMN "tier_thresholds_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "scoring_model"."attributes_json" IS 'Fabric copy of attributes as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "scoring_model"."tier_thresholds_json" IS 'Fabric copy of tier_thresholds as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "scoring_model"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('attributes', 'tier_thresholds');
--> statement-breakpoint
UPDATE "scoring_model" SET
    "attributes_json" = to_jsonb("attributes")::text,
    "tier_thresholds_json" = to_jsonb("tier_thresholds")::text
  WHERE "attributes" IS NOT NULL OR "tier_thresholds" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "segregation_rule"
  ADD COLUMN "gate_keys_json" text,
  ADD COLUMN "outcome_keys_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "segregation_rule"."gate_keys_json" IS 'Fabric copy of gate_keys as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "segregation_rule"."outcome_keys_json" IS 'Fabric copy of outcome_keys as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "segregation_rule"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('gate_keys', 'outcome_keys');
--> statement-breakpoint
UPDATE "segregation_rule" SET
    "gate_keys_json" = to_jsonb("gate_keys")::text,
    "outcome_keys_json" = to_jsonb("outcome_keys")::text
  WHERE "gate_keys" IS NOT NULL OR "outcome_keys" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot"
  ADD COLUMN "data_quality_json" text,
  ADD COLUMN "raw_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "sf_opportunity_snapshot"."data_quality_json" IS 'Fabric copy of data_quality as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
COMMENT ON COLUMN "sf_opportunity_snapshot"."raw_json" IS 'Fabric copy of raw as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "sf_opportunity_snapshot"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('data_quality', 'raw');
--> statement-breakpoint
UPDATE "sf_opportunity_snapshot" SET
    "data_quality_json" = to_jsonb("data_quality")::text,
    "raw_json" = to_jsonb("raw")::text
  WHERE "data_quality" IS NOT NULL OR "raw" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "transition_rule"
  ADD COLUMN "target_stage_keys_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "transition_rule"."target_stage_keys_json" IS 'Fabric copy of target_stage_keys as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "transition_rule"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('target_stage_keys');
--> statement-breakpoint
UPDATE "transition_rule" SET
    "target_stage_keys_json" = to_jsonb("target_stage_keys")::text
  WHERE "target_stage_keys" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference"
  ADD COLUMN "value_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "user_preference"."value_json" IS 'Fabric copy of value as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "user_preference"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('value');
--> statement-breakpoint
UPDATE "user_preference" SET
    "value_json" = to_jsonb("value")::text
  WHERE "value" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_scope"
  ADD COLUMN "values_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "user_scope"."values_json" IS 'Fabric copy of values as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "user_scope"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('values');
--> statement-breakpoint
UPDATE "user_scope" SET
    "values_json" = to_jsonb("values")::text
  WHERE "values" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "value_list"
  ADD COLUMN "meta_json" text;
--> statement-breakpoint
COMMENT ON COLUMN "value_list"."meta_json" IS 'Fabric copy of meta as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';
--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "value_list"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('meta');
--> statement-breakpoint
UPDATE "value_list" SET
    "meta_json" = to_jsonb("meta")::text
  WHERE "meta" IS NOT NULL;
--> statement-breakpoint

-- 3. audit_event is append-only (CLAUDE.md rule 3): its rows are never updated, so its copies go to the
--    insert-only side table audit_event_fabric, written by an AFTER INSERT trigger and backfilled by an
--    INSERT … SELECT. No audit_event row is changed.
CREATE OR REPLACE FUNCTION audit_event_fabric_copy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_event_fabric (audit_event_id, actor_roles_json, before_json, after_json)
  VALUES (NEW.id, to_jsonb(NEW.actor_roles)::text, to_jsonb(NEW.before)::text, to_jsonb(NEW.after)::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER zz_fabric_side_copy AFTER INSERT ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_fabric_copy();
--> statement-breakpoint
CREATE TRIGGER audit_event_fabric_append_only
  BEFORE UPDATE OR DELETE ON "audit_event_fabric"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_fabric_no_truncate
  BEFORE TRUNCATE ON "audit_event_fabric"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint
-- The app role only inserts (through the trigger); it never reads, updates or deletes.
REVOKE ALL ON "audit_event_fabric" FROM ccq_app;
--> statement-breakpoint
GRANT INSERT ON "audit_event_fabric" TO ccq_app;
--> statement-breakpoint
ALTER TABLE "audit_event_fabric" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_event_fabric" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_event_fabric_app_insert ON "audit_event_fabric" FOR INSERT TO ccq_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_event_fabric_migrator ON "audit_event_fabric" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
INSERT INTO "audit_event_fabric" (audit_event_id, actor_roles_json, before_json, after_json)
  SELECT id, to_jsonb(actor_roles)::text, to_jsonb(before)::text, to_jsonb(after)::text FROM "audit_event"
  ON CONFLICT (audit_event_id) DO NOTHING;
