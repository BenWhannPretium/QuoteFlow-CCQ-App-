-- Fabric (T-SQL) twin of packages/db/sql/analytics/80_assignment.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION: engineering queue responsiveness, one row per quote with an assigned engineer. queue_entered_at = when the quote last entered Engineering Review before the current assignment; assigned_at = the CURRENT assignment (a reassignment resets it, so the figure is time to the latest assignment). time_to_assign_s = queue_entered_at to assigned_at, minus recorded holds. assign_to_g2_s = assigned_at to the first G2 decision that is not a Hold, minus recorded holds (null while G2 is undecided). Compared across priority_tier it shows whether the manual queue honours priority.
--
-- Fabric notes: the Postgres lateral "order by ... desc limit 1" / "order by ... limit 1" pick a single
-- column, so they are written as MAX / MIN aggregates in an APPLY (same value, no TOP/ORDER BY needed).
-- The first lateral is an inner join in Postgres (no ENG_REVIEW entry before assigned_at -> no row), kept by
-- the "qe.entered_at IS NOT NULL" filter. Both hold subtractions are the inlined analytics_held_seconds
-- (see 00_functions.sql); the second only matters when g2.decided_at is not null, as in Postgres.
CREATE OR ALTER VIEW analytics.analytics_assignment AS
SELECT
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.priority_tier,
  aq.priority_score,
  aq.assigned_engineer_id,
  aq.assigned_engineer_name,
  qe.entered_at                          AS queue_entered_at,
  aq.assigned_at,
  CAST(GREATEST(
    CAST(DATEDIFF_BIG(microsecond, qe.entered_at, aq.assigned_at) AS float) / 1000000.0 - h1.held_s,
    CAST(0 AS float)) AS float)          AS time_to_assign_s,
  g2.decided_at                          AS g2_decided_at,
  CASE WHEN g2.decided_at IS NOT NULL THEN
    CAST(GREATEST(
      CAST(DATEDIFF_BIG(microsecond, aq.assigned_at, g2.decided_at) AS float) / 1000000.0 - h2.held_s,
      CAST(0 AS float)) AS float)
  END                                    AS assign_to_g2_s
FROM analytics.analytics_quote aq
CROSS APPLY (
  SELECT MAX(sh.entered_at) AS entered_at
  FROM public.stage_history sh
  WHERE sh.quote_id = aq.quote_id AND sh.stage_key = 'ENG_REVIEW' AND sh.entered_at <= aq.assigned_at
) qe
OUTER APPLY (
  SELECT MIN(g.decided_at) AS decided_at
  FROM public.gate_decision g
  WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G2' AND g.outcome_key <> 'hold' AND g.decided_at >= aq.assigned_at
) g2
OUTER APPLY (
  SELECT CAST(ISNULL(SUM(CASE
           WHEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, qe.entered_at), LEAST(ISNULL(h.ended_at, aq.assigned_at), aq.assigned_at)) > 0
           THEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, qe.entered_at), LEAST(ISNULL(h.ended_at, aq.assigned_at), aq.assigned_at))
           ELSE 0 END), 0) AS float) / 1000000.0 AS held_s
  FROM public.quote_hold h
  WHERE h.quote_id = aq.quote_id
    AND h.started_at < aq.assigned_at
    AND ISNULL(h.ended_at, aq.assigned_at) > qe.entered_at
) h1
OUTER APPLY (
  SELECT CAST(ISNULL(SUM(CASE
           WHEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, aq.assigned_at), LEAST(ISNULL(h.ended_at, g2.decided_at), g2.decided_at)) > 0
           THEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, aq.assigned_at), LEAST(ISNULL(h.ended_at, g2.decided_at), g2.decided_at))
           ELSE 0 END), 0) AS float) / 1000000.0 AS held_s
  FROM public.quote_hold h
  WHERE h.quote_id = aq.quote_id
    AND h.started_at < g2.decided_at
    AND ISNULL(h.ended_at, g2.decided_at) > aq.assigned_at
) h2
WHERE aq.assigned_at IS NOT NULL
  AND qe.entered_at IS NOT NULL;
GO
