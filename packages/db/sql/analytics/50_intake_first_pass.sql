drop view if exists analytics_intake_first_pass cascade;
create view analytics_intake_first_pass with (security_invoker = true) as
select
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.created_at,
  fe.first_engineering_at,
  coalesce(rw.n, 0)::int                     as rework_count,
  fe.first_engineering_at is not null        as reached_engineering,
  (coalesce(rw.n, 0) = 0)                    as first_pass
from analytics_quote aq
left join lateral (
  select min(sh.entered_at) as first_engineering_at
  from stage_history sh where sh.quote_id = aq.quote_id and sh.stage_key = 'ENG_REVIEW'
) fe on true
left join lateral (
  select count(*) as n
  from gate_decision g
  where g.quote_id = aq.quote_id and g.gate_key in ('G1', 'G2') and g.outcome_key = 'rework'
) rw on true
-- Only quotes whose intake has been resolved: they reached Engineering, or were sent back for rework.
-- A quote still waiting for G1 says nothing about intake quality yet.
where fe.first_engineering_at is not null or coalesce(rw.n, 0) > 0;

comment on view analytics_intake_first_pass is
  'BUSINESS DEFINITION (S-03): first-pass intake completeness. One row per quote whose intake has been resolved (it reached Engineering Review, or a G1/G2 decision sent it back for Rework). first_pass = it never needed a Rework at G1 or G2. The metric is first_pass count / row count. Quotes still waiting for G1, on hold at G1 or stopped before engineering are not in the base, so a young pilot is not flattered by work nobody has judged yet.';
grant select on analytics_intake_first_pass to ccq_app, ccq_migrator, ccq_readonly;
