-- Fabric (T-SQL) twin of packages/db/sql/analytics/96_quote_item.sql. Keep both in step (CLAUDE.md rule 10; a test checks every view has a twin).
-- UNTESTED against a live endpoint until the B-27 test mirror exists (B-27 §5): D&A, run it there and report any error.
-- Target: the SQL analytics endpoint of the CCQ *mirrored database* (Azure Database for PostgreSQL -> Fabric).
-- Mirrored tables keep the Postgres schema (public.<table>) and are read-only; views live in schema analytics
-- (created by 00_functions.sql, so run the files in name order). Output column names and order match the
-- Postgres view exactly. Postgres security_invoker and GRANT lines are dropped on purpose: OneLake does not
-- carry Postgres RLS or grants, and Fabric permissions (incl. the commercial-column rule) are owned by D&A (B-27 §3).
-- Batches are separated by GO (SSMS / sqlcmd / VS Code mssql style).
--
-- BUSINESS DEFINITION (FB-19, W13-32, D-005 provisional): one row per item of a CCQ quote (a quote holds one or more items, quoted together under one quote number). item_no is 1…n within the quote; item 1 is the primary item, whose product columns the quote mirrors. item_count is how many items the quote holds. est_annual_volume is the item's own volume (the quote's volume in analytics_quote is the sum of its items'). plant_code, machine_type, process_type and cavitation are what Engineering chose for the item (null until it is worked). No customer data and no capital figures are held. Operational metrics from QuoteFlow; not yet D&A-certified.
--
-- Fabric notes: the Postgres lateral count becomes an OUTER APPLY count; count(*)::int is COUNT(*) (int in
-- T-SQL). quote_item.components (an array) is left out here; Fabric has it as quote_item.components_json.
-- item_no is smallint and mirrors as it is.
CREATE OR ALTER VIEW analytics.analytics_quote_item AS
SELECT
  qi.id                            AS quote_item_id,
  aq.quote_id,
  aq.quote_number,
  qi.item_no,
  ic.item_count,
  qi.label                         AS item_label,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.sub_market,
  aq.stage_key,
  aq.status,
  qi.product_family,
  qi.resin,
  qi.pcr_level,
  qi.container_size,
  qi.est_annual_volume,
  qi.product_needed_by,
  qi.modify_existing_mold,
  er.plant_code,
  er.machine_type,
  er.process_type,
  er.cavitation,
  qi.created_at
FROM public.quote_item qi
JOIN analytics.analytics_quote aq ON aq.quote_id = qi.quote_id
LEFT JOIN public.eng_review er ON er.quote_item_id = qi.id
OUTER APPLY (
  SELECT COUNT(*) AS item_count FROM public.quote_item x WHERE x.quote_id = qi.quote_id
) ic;
GO
