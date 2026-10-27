-- Fabric (T-SQL) twin of packages/db/sql/analytics/50_intake_first_pass.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION (S-03): first-pass intake completeness. One row per quote whose intake has been resolved (it reached Engineering Review, or a G1/G2 decision sent it back for Rework). first_pass = it never needed a Rework at G1 or G2. The metric is first_pass count / row count. Quotes still waiting for G1, on hold at G1 or stopped before engineering are not in the base, so a young pilot is not flattered by work nobody has judged yet.
--
-- Fabric notes: left join lateral -> OUTER APPLY; COUNT(*) is already int; booleans become bit.
CREATE OR ALTER VIEW analytics.analytics_intake_first_pass AS
SELECT
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.created_at,
  fe.first_engineering_at,
  ISNULL(rw.n, 0)                        AS rework_count,
  CASE WHEN fe.first_engineering_at IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS reached_engineering,
  CASE WHEN ISNULL(rw.n, 0) = 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END                 AS first_pass
FROM analytics.analytics_quote aq
OUTER APPLY (
  SELECT MIN(sh.entered_at) AS first_engineering_at
  FROM public.stage_history sh
  WHERE sh.quote_id = aq.quote_id AND sh.stage_key = 'ENG_REVIEW'
) fe
OUTER APPLY (
  SELECT COUNT(*) AS n
  FROM public.gate_decision g
  WHERE g.quote_id = aq.quote_id AND g.gate_key IN ('G1', 'G2') AND g.outcome_key = 'rework'
) rw
-- Only quotes whose intake has been resolved: they reached Engineering, or were sent back for rework.
-- A quote still waiting for G1 says nothing about intake quality yet.
WHERE fe.first_engineering_at IS NOT NULL OR ISNULL(rw.n, 0) > 0;
GO
