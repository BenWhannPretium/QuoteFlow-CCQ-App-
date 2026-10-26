-- Fabric (T-SQL) twin of packages/db/sql/analytics/10_quote.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION: one row per CCQ quote with the dimensions every metric slices by (KAM, region, market, product family, stage, priority tier) and its close-out. sf_amount is the Salesforce opportunity amount AS ENTERED (not validated, not a price). customer_outcome is the customer answer (awarded, lost, expired; an award still in Commit & Hand Off counts as awarded). outcome_state is the customer-outcome cohort: recorded (awarded, lost or expired decided at G5) or open (waiting in Customer Decision); outcome_cohort_at is when that proposal was issued (falling back to the close date), the date the Outcomes metrics window on. Operational metrics from QuoteFlow; not yet D&A-certified.
--
-- Fabric notes: sf_opportunity_snapshot must be mirrored for this view (and every view built on it) to
-- compile; B-27 §3 leaves that table to D&A (D-FB2). sf_amount and est_annual_revenue are commercial
-- fields: hide them from non-commercial readers (rule 2, B-27 §3).
CREATE OR ALTER VIEW analytics.analytics_quote AS
SELECT
  q.id                                   AS quote_id,
  q.quote_number,
  q.kam_user_id,
  k.display_name                         AS kam_name,
  q.region,
  q.market,
  q.product_family,
  q.stage_key,
  sd.label                               AS stage_label,
  sd.sort                                AS stage_sort,
  ISNULL(sd.terminal, CAST(0 AS bit))    AS is_terminal,
  q.status,
  q.version,
  q.priority_tier,
  q.priority_score,
  q.created_at,
  q.submitted_at,
  q.closed_at,
  q.outcome,
  q.outcome_reason_code,
  q.proposal_issued_at,
  q.validity_until,
  q.assigned_engineer_id,
  e.display_name                         AS assigned_engineer_name,
  q.assigned_at,
  s.amount                               AS sf_amount,
  q.est_annual_revenue,
  -- B-26: the customer's answer. A quote awarded at G5 and still in Commit & Hand Off is a customer
  -- award (its commitment is pending), so it counts as 'awarded' here before G6 closes it.
  CASE
    WHEN q.outcome IN ('awarded', 'lost', 'expired') THEN q.outcome
    WHEN q.status <> 'closed' AND q.stage_key = 'COMMIT_HANDOFF' THEN 'awarded'
  END                                    AS customer_outcome,
  -- Customer outcome state (G5): 'recorded' = awarded / lost / expired (B-26: including awards waiting
  -- in Commit & Hand Off); 'open' = still waiting in Customer Decision. Internal closures (declined,
  -- redirected, not authorized) are neither: they never reached the customer or are not its answer.
  CASE
    WHEN q.outcome IN ('awarded', 'lost', 'expired') THEN 'recorded'
    WHEN q.status <> 'closed' AND q.stage_key = 'COMMIT_HANDOFF' THEN 'recorded'
    WHEN q.status <> 'closed' AND q.stage_key = 'CUSTOMER_DECISION' THEN 'open'
  END                                    AS outcome_state,
  CASE
    WHEN q.outcome IN ('awarded', 'lost', 'expired')
      OR (q.status <> 'closed' AND q.stage_key IN ('CUSTOMER_DECISION', 'COMMIT_HANDOFF'))
    THEN COALESCE(q.proposal_issued_at, q.closed_at, q.created_at)
  END                                    AS outcome_cohort_at
FROM public.quote q
LEFT JOIN public.app_user k ON k.id = q.kam_user_id
LEFT JOIN public.app_user e ON e.id = q.assigned_engineer_id
LEFT JOIN public.stage_definition sd ON sd.[key] = q.stage_key
LEFT JOIN public.sf_opportunity_snapshot s ON s.sf_opportunity_id = q.sf_opportunity_id;
GO
