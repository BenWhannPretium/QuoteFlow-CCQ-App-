-- Fabric (T-SQL) twin of packages/db/sql/analytics/40_quote_cycle.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION (S-01/S-02): end-to-end cycle time from intake to release, one row per quote that has a G4 Approve. started_at = first entry into Intake (the KAM submitted the request); released_at = the first G4 Approve (the internal go-ahead to issue the proposal). active_s = elapsed_s minus ALL recorded holds in between (CR-57); time a quote spends back with the KAM after a Rework stays in, because that is part of how long the customer waits. It stops at G4: customer decision time is excluded by design.
--
-- Fabric notes: each "join lateral (select min(...)) x on x.col is not null" becomes CROSS APPLY of the
-- same aggregate plus the same IS NOT NULL filter in WHERE. held_s is the inlined
-- analytics_held_seconds(aq.quote_id, st.started_at, rel.released_at) (see 00_functions.sql).
CREATE OR ALTER VIEW analytics.analytics_quote_cycle AS
SELECT
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  st.started_at,
  rel.released_at,
  el.elapsed_s,
  hs.held_s,
  CAST(GREATEST(el.elapsed_s - hs.held_s, CAST(0 AS float)) AS float) AS active_s
FROM analytics.analytics_quote aq
CROSS APPLY (
  SELECT MIN(sh.entered_at) AS started_at
  FROM public.stage_history sh
  WHERE sh.quote_id = aq.quote_id AND sh.stage_key = 'INTAKE'
) st
CROSS APPLY (
  SELECT MIN(g.decided_at) AS released_at
  FROM public.gate_decision g
  WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G4' AND g.outcome_key = 'approve'
) rel
CROSS APPLY (
  SELECT CAST(DATEDIFF_BIG(microsecond, st.started_at, rel.released_at) AS float) / 1000000.0 AS elapsed_s
) el
OUTER APPLY (
  SELECT CAST(ISNULL(SUM(CASE
           WHEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, st.started_at), LEAST(ISNULL(h.ended_at, rel.released_at), rel.released_at)) > 0
           THEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, st.started_at), LEAST(ISNULL(h.ended_at, rel.released_at), rel.released_at))
           ELSE 0 END), 0) AS float) / 1000000.0 AS held_s
  FROM public.quote_hold h
  WHERE h.quote_id = aq.quote_id
    AND h.started_at < rel.released_at
    AND ISNULL(h.ended_at, rel.released_at) > st.started_at
) hs
WHERE st.started_at IS NOT NULL
  AND rel.released_at IS NOT NULL;
GO
