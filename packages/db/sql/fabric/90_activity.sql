-- Fabric (T-SQL) twin of packages/db/sql/analytics/90_activity.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- Fabric notes: audit_event.actor_roles is a Postgres text[] and is NOT mirrored. audit_event is append-only
-- (rule 3), so its JSON-array copy (e.g. ["KAM","Admin"]) lives in the insert-only side table
-- audit_event_fabric.actor_roles_json, one row per audit row, written by an AFTER INSERT trigger and
-- backfilled (migration 0022). It is read here with OPENJSON. unnest() over an empty array and OPENJSON over
-- '[]' or NULL both yield no rows, so an audit row without roles (or without a side row) counts nowhere.
-- The US Central Monday is the inlined analytics_week(a.at) (see 00_functions.sql).

-- BUSINESS DEFINITION (S-10 adoption): one row per user, role held at the time and US Central week, with their audit-event count. A user is ACTIVE in a week when they have at least one audit event (any view, create or decision) in it. Weekly active users by role = count of rows per week and role. A user holding several roles counts once under each role. Readable only to audit.read holders (audit_event row-level security).
-- (In Fabric the "audit.read holders" restriction is D&A's to rebuild; Postgres RLS does not carry over.)
CREATE OR ALTER VIEW analytics.analytics_user_activity_weekly AS
SELECT
  wk.week,
  r.[role],
  a.actor_id,
  COUNT(*)                               AS events
FROM public.audit_event a
JOIN public.audit_event_fabric af ON af.audit_event_id = a.id
CROSS APPLY OPENJSON(af.actor_roles_json) WITH ([role] varchar(200) '$') r
CROSS APPLY (
  SELECT CAST(a.[at] AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS date) AS local_date
) ld
CROSS APPLY (
  SELECT DATEADD(day, -(DATEDIFF(day, CAST('19000101' AS date), ld.local_date) % 7), ld.local_date) AS week
) wk
WHERE a.actor_id IS NOT NULL
GROUP BY wk.week, r.[role], a.actor_id;
GO

-- BUSINESS DEFINITION (S-10): one row per intake submitted in QuoteFlow (audit action create on a quote, written when a draft is submitted). Counted per US Central week. Intakes still raised outside QuoteFlow (the legacy ERF flow) are invisible here by construction. Readable only to audit.read holders.
CREATE OR ALTER VIEW analytics.analytics_intake_created AS
SELECT
  a.[at],
  wk.week,
  a.actor_id,
  a.quote_id
FROM public.audit_event a
CROSS APPLY (
  SELECT CAST(a.[at] AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS date) AS local_date
) ld
CROSS APPLY (
  SELECT DATEADD(day, -(DATEDIFF(day, CAST('19000101' AS date), ld.local_date) % 7), ld.local_date) AS week
) wk
WHERE a.[action] = 'create' AND a.entity = 'quote';
GO
