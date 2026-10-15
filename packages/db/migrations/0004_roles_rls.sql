-- B-03: database roles, grants and row-level security (architecture §3.2 and §7).
--
-- Roles (NOLOGIN groups; real logins such as the App Service managed identity are granted membership):
--   ccq_app       runtime API. CRUD on app tables; INSERT + SELECT only on audit_event / activity_event.
--   ccq_migrator  runs migrations and seeds; sees every row.
--   ccq_readonly  D&A read access (later); SELECT on everything.
--
-- The API runs each request in a transaction that does `SET LOCAL ROLE ccq_app` and sets
-- app.user_id, app.roles (csv), app.scope_type and app.scope_values (csv): see src/withRequestContext.ts.
-- With no context set, ccq_app sees no quote rows. Superusers bypass RLS (local dev tooling only).

-- ── Roles (cluster-wide, so tolerate them already existing) ─────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['ccq_app', 'ccq_migrator', 'ccq_readonly'] LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO ccq_app, ccq_migrator, ccq_readonly;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO ccq_migrator;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ccq_readonly;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccq_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event, activity_event FROM ccq_app;
--> statement-breakpoint
REVOKE ALL ON quote_number_counter FROM ccq_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION next_quote_number(timestamptz) TO ccq_app, ccq_migrator;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ccq_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ccq_readonly;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ccq_migrator;
--> statement-breakpoint

-- ── audit_event is append-only for everyone, owner included ────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint

-- ── Request-context accessors (empty / unset settings read as "no context") ────────────────────
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_roles() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), '{}'::text[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_scope_type() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.scope_type', true), ''), 'none') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_scope_values() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.scope_values', true), ''), ','), '{}'::text[])
$$;
--> statement-breakpoint

-- Roles that see every quote in MVP (architecture §3.2: full pipeline for these roles).
CREATE OR REPLACE FUNCTION app_sees_all_quotes() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_roles() && ARRAY['Admin', 'Leadership', 'EngLead', 'Pricing', 'Approver', 'SalesLeader']::text[]
$$;
--> statement-breakpoint

-- Row visibility for a quote. KAM and Engineer follow their data scope:
--   all → every quote; owner → kam_user_id (KAM) or assigned_engineer_id (Engineer) is the user;
--   region → quote.region in scope values; account_list → the customer's SF account id in scope values.
-- PostAward (P2) sees Awarded quotes only. No context → nothing.
CREATE OR REPLACE FUNCTION app_quote_visible(
  p_kam_user_id uuid,
  p_assigned_engineer_id uuid,
  p_region text,
  p_customer_id uuid,
  p_stage_key text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_sees_all_quotes()
    OR (
      app_roles() && ARRAY['KAM', 'Engineer']::text[]
      AND CASE app_scope_type()
        WHEN 'all' THEN true
        WHEN 'owner' THEN
          ('KAM' = ANY (app_roles()) AND p_kam_user_id = app_user_id())
          OR ('Engineer' = ANY (app_roles()) AND p_assigned_engineer_id = app_user_id())
        WHEN 'region' THEN p_region = ANY (app_scope_values())
        WHEN 'account_list' THEN EXISTS (
          SELECT 1 FROM customer c
          WHERE c.id = p_customer_id AND c.sf_account_id = ANY (app_scope_values())
        )
        ELSE false
      END
    )
    OR ('PostAward' = ANY (app_roles()) AND p_stage_key = 'AWARDED')
$$;
--> statement-breakpoint

-- ── quote ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE quote ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_app ON quote FOR ALL TO ccq_app
  USING (app_quote_visible(kam_user_id, assigned_engineer_id, region, customer_id, stage_key))
  WITH CHECK (app_quote_visible(kam_user_id, assigned_engineer_id, region, customer_id, stage_key));
--> statement-breakpoint
CREATE POLICY quote_migrator ON quote FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY quote_readonly ON quote FOR SELECT TO ccq_readonly USING (true);
--> statement-breakpoint

-- ── quote child tables: visible when the parent quote is (the sub-select is itself under RLS) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stage_history', 'quote_hold', 'gate_decision', 'eng_review', 'capacity_evidence',
    'pricing_record', 'override', 'attachment', 'comment', 'handoff_record', 'activity_event'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO ccq_app
         USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = %I.quote_id))
         WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = %I.quote_id))',
      t || '_app', t, t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO ccq_migrator USING (true) WITH CHECK (true)', t || '_migrator', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO ccq_readonly USING (true)', t || '_readonly', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ── audit_event: anyone in a request context may append; reads are Leadership/Admin or your own ─
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_event_app_insert ON audit_event FOR INSERT TO ccq_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_event_app_select ON audit_event FOR SELECT TO ccq_app
  USING (actor_id = app_user_id() OR app_roles() && ARRAY['Admin', 'Leadership']::text[]);
--> statement-breakpoint
CREATE POLICY audit_event_migrator ON audit_event FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_event_readonly ON audit_event FOR SELECT TO ccq_readonly USING (true);
--> statement-breakpoint

-- ── notification: the recipient (or Admin) reads and updates; any context may create ───────────
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_app_insert ON notification FOR INSERT TO ccq_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY notification_app_select ON notification FOR SELECT TO ccq_app
  USING (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY notification_app_update ON notification FOR UPDATE TO ccq_app
  USING (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY notification_app_delete ON notification FOR DELETE TO ccq_app
  USING (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY notification_migrator ON notification FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY notification_readonly ON notification FOR SELECT TO ccq_readonly USING (true);
