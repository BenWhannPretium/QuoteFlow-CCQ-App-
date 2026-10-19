drop view if exists analytics_assignment cascade;
create view analytics_assignment with (security_invoker = true) as
select
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
  q.entered_at                                       as queue_entered_at,
  aq.assigned_at,
  greatest(extract(epoch from (aq.assigned_at - q.entered_at))
    - analytics_held_seconds(aq.quote_id, q.entered_at, aq.assigned_at), 0)::float8 as time_to_assign_s,
  g2.decided_at                                      as g2_decided_at,
  case when g2.decided_at is not null then
    greatest(extract(epoch from (g2.decided_at - aq.assigned_at))
      - analytics_held_seconds(aq.quote_id, aq.assigned_at, g2.decided_at), 0)::float8
  end                                                as assign_to_g2_s
from analytics_quote aq
join lateral (
  select sh.entered_at from stage_history sh
  where sh.quote_id = aq.quote_id and sh.stage_key = 'ENG_REVIEW' and sh.entered_at <= aq.assigned_at
  order by sh.entered_at desc limit 1
) q on true
left join lateral (
  select g.decided_at from gate_decision g
  where g.quote_id = aq.quote_id and g.gate_key = 'G2' and g.outcome_key <> 'hold' and g.decided_at >= aq.assigned_at
  order by g.decided_at limit 1
) g2 on true
where aq.assigned_at is not null;

comment on view analytics_assignment is
  'BUSINESS DEFINITION: engineering queue responsiveness, one row per quote with an assigned engineer. queue_entered_at = when the quote last entered Engineering Review before the current assignment; assigned_at = the CURRENT assignment (a reassignment resets it, so the figure is time to the latest assignment). time_to_assign_s = queue_entered_at to assigned_at, minus recorded holds. assign_to_g2_s = assigned_at to the first G2 decision that is not a Hold, minus recorded holds (null while G2 is undecided). Compared across priority_tier it shows whether the manual queue honours priority.';
grant select on analytics_assignment to ccq_app, ccq_migrator, ccq_readonly;
