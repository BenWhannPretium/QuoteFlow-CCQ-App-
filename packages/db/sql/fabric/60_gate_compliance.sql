-- Fabric (T-SQL) twin of packages/db/sql/analytics/60_gate_compliance.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION (S-08): gate compliance. One row per quote whose proposal was issued. has_g1..has_g4 = at least one gate decision is recorded for that gate (the G1 column also accepts the SUBMIT gate used when G1 is switched off). A quote is compliant when all four are true. Quotes created in QuoteFlow cannot reach a proposal without them, so anything below 100% is imported, backfilled or migrated data.
--
-- Fabric notes: EXISTS cannot be a select-list value in T-SQL, so each becomes CASE WHEN EXISTS ... (bit).
CREATE OR ALTER VIEW analytics.analytics_gate_compliance AS
SELECT
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.proposal_issued_at,
  CASE WHEN EXISTS (SELECT 1 FROM public.gate_decision g WHERE g.quote_id = aq.quote_id AND g.gate_key IN ('G1', 'SUBMIT'))
       THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_g1,
  CASE WHEN EXISTS (SELECT 1 FROM public.gate_decision g WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G2')
       THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_g2,
  CASE WHEN EXISTS (SELECT 1 FROM public.gate_decision g WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G3')
       THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_g3,
  CASE WHEN EXISTS (SELECT 1 FROM public.gate_decision g WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G4')
       THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_g4
FROM analytics.analytics_quote aq
WHERE aq.proposal_issued_at IS NOT NULL;
GO
