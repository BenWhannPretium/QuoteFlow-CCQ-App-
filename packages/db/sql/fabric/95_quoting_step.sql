-- Fabric (T-SQL) twin of packages/db/sql/analytics/95_quoting_step.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION (FB-07, D-001): the Quoting steps in order (costing, then ROI, then price approved), one row per quote that has reached Quoting, for its current version. cost_model_requirement = required, or grandfathered (in Quoting with costing attested before the costing model was kept in QuoteFlow). *_versions = how many versions of the costing model, ROI model and updated price table are on file (removed uploads excluded); *_first_at / *_latest_at = when the first and the latest version were uploaded (UTC). price_approved_at = the G3 "Advance – price approved" decision on the current version (null until the price is approved). The ROI step applies only when capital is required (app_setting roi_required_when), so roi_model_versions = 0 is normal for other quotes. No figures from the models are held.
--
-- Fabric notes: the Postgres lateral aggregates become OUTER APPLY aggregates; count(*)::int is COUNT(*)
-- (int in T-SQL). attachment.version / superseded_* and pricing_record.cost_model_requirement are plain
-- integer / uuid / timestamptz / text columns, so they mirror as they are.
CREATE OR ALTER VIEW analytics.analytics_quoting_step AS
SELECT
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.stage_key,
  aq.status,
  aq.version                       AS quote_version,
  pr.cost_model_requirement,
  pr.costing_completed,
  pr.costing_attested_at,
  ISNULL(cm.versions, 0)           AS cost_model_versions,
  cm.first_at                      AS cost_model_first_at,
  cm.latest_at                     AS cost_model_latest_at,
  ISNULL(rm.versions, 0)           AS roi_model_versions,
  rm.first_at                      AS roi_model_first_at,
  rm.latest_at                     AS roi_model_latest_at,
  ISNULL(pt.versions, 0)           AS price_table_versions,
  g3.decided_at                    AS price_approved_at
FROM analytics.analytics_quote aq
JOIN public.pricing_record pr ON pr.quote_id = aq.quote_id AND pr.quote_version = aq.version
OUTER APPLY (
  SELECT COUNT(*) AS versions, MIN(a.created_at) AS first_at, MAX(a.created_at) AS latest_at
  FROM public.attachment a
  WHERE a.quote_id = aq.quote_id AND a.kind = 'cost_model' AND a.removed_at IS NULL
) cm
OUTER APPLY (
  SELECT COUNT(*) AS versions, MIN(a.created_at) AS first_at, MAX(a.created_at) AS latest_at
  FROM public.attachment a
  WHERE a.quote_id = aq.quote_id AND a.kind = 'roi_model' AND a.removed_at IS NULL
) rm
OUTER APPLY (
  SELECT COUNT(*) AS versions
  FROM public.attachment a
  WHERE a.quote_id = aq.quote_id AND a.kind = 'price_table' AND a.removed_at IS NULL
) pt
OUTER APPLY (
  SELECT MAX(g.decided_at) AS decided_at
  FROM public.gate_decision g
  WHERE g.quote_id = aq.quote_id AND g.gate_key = 'G3' AND g.outcome_key = 'submit'
    AND g.quote_version = aq.version
) g3;
GO
