-- Fabric (T-SQL) twin of packages/db/sql/analytics/30_gate_decision.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION: one row per recorded gate decision (G1 qualify, G2 feasibility, G3 price/capital, G4 release, G5 outcome), with who decided, the outcome and reason code, and the quote dimensions. superseded = the decision was taken on an earlier quote version (a later rework, return or re-quote bumped the version); decisions are kept, never edited (CR-38). Feeds G1 qualification yield (S-04), the reasons work is returned to the KAM, and Final Review decisions.
--
-- Fabric notes: the boolean superseded becomes bit; NULL when either version is NULL, as in Postgres.
CREATE OR ALTER VIEW analytics.analytics_gate_decision AS
SELECT
  g.id                                   AS decision_id,
  g.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  g.gate_key,
  g.outcome_key,
  g.decided_by,
  du.display_name                        AS decided_by_name,
  g.decided_at,
  g.reason_code,
  g.target_stage_key,
  g.quote_version,
  CASE
    WHEN g.quote_version < aq.version THEN CAST(1 AS bit)
    WHEN g.quote_version >= aq.version THEN CAST(0 AS bit)
  END                                    AS superseded,
  g.note
FROM public.gate_decision g
JOIN analytics.analytics_quote aq ON aq.quote_id = g.quote_id
LEFT JOIN public.app_user du ON du.id = g.decided_by;
GO
