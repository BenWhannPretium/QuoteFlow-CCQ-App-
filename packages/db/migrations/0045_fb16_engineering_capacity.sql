ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_role_check";--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_role_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "stage_definition" DROP CONSTRAINT "stage_definition_owner_role_check";--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "capacity_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "assigned_scheduler_id" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "assigned_scheduler_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eng_returned_to" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_assigned_scheduler_id_app_user_id_fk" FOREIGN KEY ("assigned_scheduler_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_eng_returned_to_app_user_id_fk" FOREIGN KEY ("eng_returned_to") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_assigned_scheduler_id_idx" ON "quote" USING btree ("assigned_scheduler_id");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_check" CHECK ("role_permission"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'ProductionScheduler', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'ProductionScheduler', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_owner_role_check" CHECK ("stage_definition"."owner_role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'ProductionScheduler', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
-- ── FB-16 (hand-written): engineering and capacity ───────────────────────────────────────────────────
-- Walkthrough 2026-11-13 (W13-12 to W13-21): one "Process & machine type" pick filtered by plant, the
-- pack-out rule, the Production Scheduler role as a second assignee, a capacity block that returns the
-- work to the engineer, capacity approved inside "Decide feasibility", and the stage relabelled
-- "Engineering & Capacity". Tracker rows it follows: F-057, F-025, F-062 / D-008 / A-007, D-021.
--
-- The statements above add the role and the permission to the CHECK lists (the Production Scheduler,
-- capacity.edit), the second assignee (quote.assigned_scheduler_id / assigned_scheduler_at), who a lead's
-- send-back went to (quote.eng_returned_to) and when the scheduler was told capacity can start
-- (eng_review.capacity_ready_at). uuid and timestamptz only: nothing for the Fabric companions (rule 10).
--
-- Config follows the rule of 0026 and 0036: a row the business approved (approved_at set) is never
-- changed and a value an Admin edited (it no longer equals the previous seed) is left alone. On a fresh
-- database the config tables are empty here: each statement is a no-op and the seed inserts the same
-- values. Every statement is safe to re-run.
--
-- W13-15 (D-008 open, provisional): the production scheduler sees the quotes they are assigned to, as an
-- Engineer sees theirs. app_quote_visible has a fixed argument list used only by the quote_app policy, and
-- CREATE OR REPLACE cannot add an argument (it would create an overload), so: drop the policy, drop and
-- recreate the function with the scheduler column, recreate the policy. Quote child tables follow the
-- parent (0004), so they need no change. All inside this migration's transaction.
DROP POLICY IF EXISTS quote_app ON quote;--> statement-breakpoint
DROP FUNCTION IF EXISTS app_quote_visible(uuid, uuid, text, uuid, text);--> statement-breakpoint
DROP FUNCTION IF EXISTS app_quote_visible(uuid, uuid, text, uuid, text, uuid);--> statement-breakpoint
-- Row visibility for a quote. KAM, Engineer and ProductionScheduler follow their data scope:
--   all → every quote; owner → kam_user_id (KAM), assigned_engineer_id (Engineer) or
--   assigned_scheduler_id (ProductionScheduler) is the user; region → quote.region in scope values;
--   account_list → the customer's SF account id in scope values.
-- PostAward (P2) sees Awarded quotes only. No context → nothing.
CREATE FUNCTION app_quote_visible(
  p_kam_user_id uuid,
  p_assigned_engineer_id uuid,
  p_region text,
  p_customer_id uuid,
  p_stage_key text,
  p_assigned_scheduler_id uuid
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_sees_all_quotes()
    OR (
      app_roles() && ARRAY['KAM', 'Engineer', 'ProductionScheduler']::text[]
      AND CASE app_scope_type()
        WHEN 'all' THEN true
        WHEN 'owner' THEN
          ('KAM' = ANY (app_roles()) AND p_kam_user_id = app_user_id())
          OR ('Engineer' = ANY (app_roles()) AND p_assigned_engineer_id = app_user_id())
          OR ('ProductionScheduler' = ANY (app_roles()) AND p_assigned_scheduler_id = app_user_id())
        WHEN 'region' THEN p_region = ANY (app_scope_values())
        WHEN 'account_list' THEN EXISTS (
          SELECT 1 FROM customer c
          WHERE c.id = p_customer_id AND c.sf_account_id = ANY (app_scope_values())
        )
        ELSE false
      END
    )
    OR ('PostAward' = ANY (app_roles()) AND p_stage_key = 'AWARDED')
$$;--> statement-breakpoint
CREATE POLICY quote_app ON quote FOR ALL TO ccq_app
  USING (app_quote_visible(kam_user_id, assigned_engineer_id, region, customer_id, stage_key, assigned_scheduler_id))
  WITH CHECK (app_quote_visible(kam_user_id, assigned_engineer_id, region, customer_id, stage_key, assigned_scheduler_id));--> statement-breakpoint
-- Rule 2: every role that reads a quote sees its figures, so the scheduler reads the pricing-app history
-- like every other role that holds quote.read.commercialFields (0024, 0031).
DROP POLICY IF EXISTS pricing_history_record_app_select ON pricing_history_record;--> statement-breakpoint
CREATE POLICY pricing_history_record_app_select ON pricing_history_record FOR SELECT TO ccq_app
  USING (app_roles() && ARRAY['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'ProductionScheduler', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward']::text[]);--> statement-breakpoint
-- W13-15: the matrix rows (policy/matrix.ts is the control; role_permission mirrors it). Provisional.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.role, v.permission, v.qualifier::jsonb, true
FROM (VALUES
  ('ProductionScheduler', 'quote.read', NULL),
  ('ProductionScheduler', 'quote.read.commercialFields', NULL),
  ('ProductionScheduler', 'engQueue.read', NULL),
  ('EngLead', 'capacity.edit', NULL),
  ('Engineer', 'capacity.edit', '{"kind":"assigned"}'),
  ('ProductionScheduler', 'capacity.edit', '{"kind":"assignedScheduler"}'),
  ('ProductionScheduler', 'capacity.signoff', '{"kind":"assignedScheduler"}')
) AS v(role, permission, qualifier)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
-- W13-12, W13-13, W13-14: the three new settings (provisional).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('machine_type_process_map', '{"EBM":"EBM","IBM":"IBM","ISBM":"ISBM","RHB":"RHB","INJ-CAP":"IMM","INJ-PREFORM":"IMM_PREFORM","INJ-OTHER":"IMM","DECO":"OTHER","PAD PRINTING":"OTHER","PRINTING":"OTHER","LAMINATION":"OTHER","DIE CUTTING":"OTHER","STAMPING":"OTHER","12B":"OTHER"}',
   'FB-16 (W13-12): the process type behind each machine type. The engineer picks one "Process & machine type" (a machine type the chosen plant runs) and the server stores the process type from this map, so the G2 rule, the routing suggestion and the volume guardrails keep reading process_type. Every key must be an active machine type and every value an active process type. The non-forming machine types (DECO, PAD PRINTING, PRINTING, LAMINATION, DIE CUTTING, STAMPING, 12B) are OTHER until Engineering (Jim Zweifel) names their process (W13-W11). Provisional.'),
  ('two_step_plant_machine_types', '{"preform":["INJ-PREFORM"],"blow":["RHB","ISBM"]}',
   'FB-16 (W13-13): for a two-step process, the machine types a plant must run to be offered as the Preform plant (preform) or the Blow plant (blow). Machine-type codes. Seed: preform INJ-PREFORM; blow RHB or ISBM. Provisional.'),
  ('pack_out_rule', '{"requireOneOf":false,"notTogether":[["unitsPerBag","unitsPerCase"]]}',
   'FB-16 (W13-14): pack-out. notTogether lists groups of counts of which only one may be filled (seed: units per bag and units per case). requireOneOf: when true, G2 cannot advance until one of units per bag, tray or case is filled; seeded false until Engineering confirms they know pack-out at quote time (W13-W7). Provisional.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- W13-16 (provisional): the stage is "Engineering & Capacity". Only while it is still the seeded
-- "Engineering Review" and unapproved; an Admin's own label is kept. The stage key does not change.
UPDATE "stage_definition" SET "label" = 'Engineering & Capacity', "updated_at" = now()
WHERE "key" = 'ENG_REVIEW' AND "approved_at" IS NULL AND "label" = 'Engineering Review';--> statement-breakpoint
-- W13-16: the two G2 help texts that named the stage no longer repeat its label (it is Admin-editable).
-- As 0031 and 0042: only while the text is still the seed wording and unapproved.
UPDATE "gate_outcome_definition" SET "help_text" = 'Pause it at this stage. The clock stops. Needs a reason, an owner and a review date.', "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'hold' AND "approved_at" IS NULL
  AND "help_text" = 'Pause it in Engineering Review. The clock stops. Needs a reason, an owner and a review date.';--> statement-breakpoint
UPDATE "gate_outcome_definition" SET "help_text" = 'Work an alternative platform or site instead. The quote stays at this stage; the note says what changes.', "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'redirect' AND "approved_at" IS NULL
  AND "help_text" = 'Work an alternative platform or site instead. The quote stays in Engineering Review; the note says what changes.';
