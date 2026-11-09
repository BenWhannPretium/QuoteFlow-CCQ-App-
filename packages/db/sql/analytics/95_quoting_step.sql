drop view if exists analytics_quoting_step cascade;
create view analytics_quoting_step with (security_invoker = true) as
select
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.stage_key,
  aq.status,
  aq.version                       as quote_version,
  pr.cost_model_requirement,
  pr.costing_completed,
  pr.costing_attested_at,
  coalesce(cm.versions, 0)         as cost_model_versions,
  cm.first_at                      as cost_model_first_at,
  cm.latest_at                     as cost_model_latest_at,
  coalesce(rm.versions, 0)         as roi_model_versions,
  rm.first_at                      as roi_model_first_at,
  rm.latest_at                     as roi_model_latest_at,
  coalesce(pt.versions, 0)         as price_table_versions,
  g3.decided_at                    as price_approved_at
from analytics_quote aq
join pricing_record pr on pr.quote_id = aq.quote_id and pr.quote_version = aq.version
left join lateral (
  select count(*)::int as versions, min(a.created_at) as first_at, max(a.created_at) as latest_at
  from attachment a
  where a.quote_id = aq.quote_id and a.kind = 'cost_model' and a.removed_at is null
) cm on true
left join lateral (
  select count(*)::int as versions, min(a.created_at) as first_at, max(a.created_at) as latest_at
  from attachment a
  where a.quote_id = aq.quote_id and a.kind = 'roi_model' and a.removed_at is null
) rm on true
left join lateral (
  select count(*)::int as versions
  from attachment a
  where a.quote_id = aq.quote_id and a.kind = 'price_table' and a.removed_at is null
) pt on true
left join lateral (
  select max(g.decided_at) as decided_at
  from gate_decision g
  where g.quote_id = aq.quote_id and g.gate_key = 'G3' and g.outcome_key = 'submit'
    and g.quote_version = aq.version
) g3 on true;

comment on view analytics_quoting_step is
  'BUSINESS DEFINITION (FB-07, D-001): the Quoting steps in order (costing, then ROI, then price approved), one row per quote that has reached Quoting, for its current version. cost_model_requirement = required, or grandfathered (in Quoting with costing attested before the costing model was kept in QuoteFlow). *_versions = how many versions of the costing model, ROI model and updated price table are on file (removed uploads excluded); *_first_at / *_latest_at = when the first and the latest version were uploaded (UTC). price_approved_at = the G3 "Advance – price approved" decision on the current version (null until the price is approved). The ROI step applies only when capital is required (app_setting roi_required_when), so roi_model_versions = 0 is normal for other quotes. No figures from the models are held.';
grant select on analytics_quoting_step to ccq_app, ccq_migrator, ccq_readonly;
