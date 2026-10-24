-- L-6: CCQ is the access control for Salesforce data. CCQ reads Salesforce as one integration user for
-- everyone (L-5), so Salesforce's own sharing no longer applies per person; this scopes the synced
-- opportunities the same way quotes are scoped (0004). An opportunity is visible when:
--   1. the caller sees every quote (Admin, Leadership, EngLead, Pricing, Approver, SalesLeader, …), or
--   2. a KAM / Engineer's data scope covers it: all → every one; region → its Salesforce owner's CCQ
--      region (app_user.region, the same region a quote takes from its KAM); account_list → its SF
--      account id, or
--   3. a KAM owns it in Salesforce (owner email = their email or UPN), whatever their scope, or
--   4. the caller can see a quote linked to it (quote is under RLS), so quote pages, the board and
--      analytics keep their Salesforce columns.
-- No request context → nothing. The sync runs as the system context (Admin) and sees every row.
CREATE OR REPLACE FUNCTION app_opportunity_visible(
  p_sf_opportunity_id text,
  p_owner_email text,
  p_account_id text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_sees_all_quotes()
    OR (
      app_roles() && ARRAY['KAM', 'Engineer']::text[]
      AND CASE app_scope_type()
        WHEN 'all' THEN true
        WHEN 'region' THEN EXISTS (
          SELECT 1 FROM app_user u
          WHERE lower(u.email) = lower(p_owner_email) AND u.region = ANY (app_scope_values())
        )
        WHEN 'account_list' THEN p_account_id = ANY (app_scope_values())
        ELSE false
      END
    )
    OR (
      'KAM' = ANY (app_roles())
      AND p_owner_email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM app_user me
        WHERE me.id = app_user_id()
          AND lower(p_owner_email) IN (lower(me.email), lower(me.upn))
      )
    )
    OR EXISTS (SELECT 1 FROM quote q WHERE q.sf_opportunity_id = p_sf_opportunity_id)
$$;
--> statement-breakpoint
ALTER TABLE sf_opportunity_snapshot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sf_opportunity_snapshot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Reads and writes follow visibility: the sync (Admin) writes every row; opening an opportunity's
-- detail refreshes the copy only when the caller may see it. Snapshots are never deleted.
CREATE POLICY sf_opportunity_snapshot_app ON sf_opportunity_snapshot FOR ALL TO ccq_app
  USING (app_opportunity_visible(sf_opportunity_id, owner_email, account_id))
  WITH CHECK (app_opportunity_visible(sf_opportunity_id, owner_email, account_id));
--> statement-breakpoint
CREATE POLICY sf_opportunity_snapshot_migrator ON sf_opportunity_snapshot FOR ALL TO ccq_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY sf_opportunity_snapshot_readonly ON sf_opportunity_snapshot FOR SELECT TO ccq_readonly
  USING (true);
