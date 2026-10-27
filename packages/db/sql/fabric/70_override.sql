-- Fabric (T-SQL) twin of packages/db/sql/analytics/70_override.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION: one row per governed override request (priority tier, ship-to, queue position). requested_at is when it was asked for; decided_by is the approver (or the requester for a self-approved field). Override frequency = requests per field and per approver in a window, against the number of quotes created in the same window.
--
-- Fabric notes: the table name is bracketed ([override]) to keep it clear of T-SQL keywords.
CREATE OR ALTER VIEW analytics.analytics_override AS
SELECT
  o.id                                   AS override_id,
  o.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  o.field,
  o.status,
  o.approval_mode,
  o.requested_by,
  ru.display_name                        AS requested_by_name,
  o.decided_by,
  du.display_name                        AS decided_by_name,
  o.created_at                           AS requested_at,
  o.decided_at,
  o.applied_at
FROM public.[override] o
JOIN analytics.analytics_quote aq ON aq.quote_id = o.quote_id
LEFT JOIN public.app_user ru ON ru.id = o.requested_by
LEFT JOIN public.app_user du ON du.id = o.decided_by;
GO
