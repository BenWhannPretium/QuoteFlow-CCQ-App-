drop view if exists analytics_quote_item cascade;
create view analytics_quote_item with (security_invoker = true) as
select
  qi.id                            as quote_item_id,
  aq.quote_id,
  aq.quote_number,
  qi.item_no,
  ic.item_count,
  qi.label                         as item_label,
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
from quote_item qi
join analytics_quote aq on aq.quote_id = qi.quote_id
left join eng_review er on er.quote_item_id = qi.id
left join lateral (
  select count(*)::int as item_count from quote_item x where x.quote_id = qi.quote_id
) ic on true;

comment on view analytics_quote_item is
  'BUSINESS DEFINITION (FB-19, W13-32, D-005 provisional): one row per item of a CCQ quote (a quote holds one or more items, quoted together under one quote number). item_no is 1…n within the quote; item 1 is the primary item, whose product columns the quote mirrors. item_count is how many items the quote holds. est_annual_volume is the item''s own volume (the quote''s volume in analytics_quote is the sum of its items''). plant_code, machine_type, process_type and cavitation are what Engineering chose for the item (null until it is worked). No customer data and no capital figures are held. Operational metrics from QuoteFlow; not yet D&A-certified.';
grant select on analytics_quote_item to ccq_app, ccq_migrator, ccq_readonly;
