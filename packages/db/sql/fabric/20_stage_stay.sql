-- Fabric (T-SQL) twin of packages/db/sql/analytics/20_stage_stay.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION: one row per stay of a quote in a workflow stage (stage_history). elapsed_s is wall-clock time in the stay (an open stay runs to now). held_s is the recorded customer/internal hold time inside the stay (quote_hold). active_s = elapsed_s - held_s is the CYCLE TIME: time in stage excluding recorded holds (CR-55, CR-57). A rework or return creates a new stay, so a quote can have several stays in one stage; medians are per stay. Terminal stages (is_terminal) are never "in progress" and are excluded from cycle times and WIP. Open stays use now(), so only completed stays (exited_at is not null) give reproducible answers.
--
-- Fabric notes: the Postgres "join lateral (... from quote q left join stage_definition sd ...) on true"
-- becomes plain joins (inner to quote, so a stay whose quote is missing drops out, as in Postgres).
-- now() -> SYSUTCDATETIME(); ISNULL() keeps exited_at's datetime2(6) type, i.e. microseconds like now().
-- held_s is the inlined analytics_held_seconds(sh.quote_id, sh.entered_at, window_end) (see 00_functions.sql).
CREATE OR ALTER VIEW analytics.analytics_stage_stay AS
SELECT
  sh.id                                  AS stay_id,
  sh.quote_id,
  q.quote_number,
  q.kam_user_id,
  q.region,
  q.market,
  q.product_family,
  q.priority_tier,
  sh.stage_key,
  sd.label                               AS stage_label,
  sd.sort                                AS stage_sort,
  ISNULL(sd.terminal, CAST(0 AS bit))    AS is_terminal,
  sh.quote_version,
  sh.entered_at,
  sh.exited_at,
  CASE WHEN sh.exited_at IS NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_open,
  el.elapsed_s,
  hs.held_s,
  CAST(GREATEST(el.elapsed_s - hs.held_s, CAST(0 AS float)) AS float) AS active_s
FROM public.stage_history sh
JOIN public.quote q ON q.id = sh.quote_id
LEFT JOIN public.stage_definition sd ON sd.[key] = sh.stage_key
CROSS APPLY (SELECT ISNULL(sh.exited_at, SYSUTCDATETIME()) AS window_end) w
CROSS APPLY (
  SELECT CAST(DATEDIFF_BIG(microsecond, sh.entered_at, w.window_end) AS float) / 1000000.0 AS elapsed_s
) el
OUTER APPLY (
  SELECT CAST(ISNULL(SUM(CASE
           WHEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, sh.entered_at), LEAST(ISNULL(h.ended_at, w.window_end), w.window_end)) > 0
           THEN DATEDIFF_BIG(microsecond, GREATEST(h.started_at, sh.entered_at), LEAST(ISNULL(h.ended_at, w.window_end), w.window_end))
           ELSE 0 END), 0) AS float) / 1000000.0 AS held_s
  FROM public.quote_hold h
  WHERE h.quote_id = sh.quote_id
    AND h.started_at < w.window_end
    AND ISNULL(h.ended_at, w.window_end) > sh.entered_at
) hs;
GO
