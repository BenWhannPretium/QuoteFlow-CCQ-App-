drop view if exists analytics_stage_stay cascade;
create view analytics_stage_stay with (security_invoker = true) as
select
  sh.id                  as stay_id,
  sh.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.priority_tier,
  sh.stage_key,
  aq.stage_label_of_stay as stage_label,
  aq.stage_sort_of_stay  as stage_sort,
  aq.stay_is_terminal    as is_terminal,
  sh.quote_version,
  sh.entered_at,
  sh.exited_at,
  sh.exited_at is null   as is_open,
  aq.elapsed_s,
  aq.held_s,
  greatest(aq.elapsed_s - aq.held_s, 0)::float8 as active_s
from stage_history sh
join lateral (
  select
    q.quote_number, q.kam_user_id, q.region, q.market, q.product_family, q.priority_tier,
    sd.label as stage_label_of_stay, sd.sort as stage_sort_of_stay, coalesce(sd.terminal, false) as stay_is_terminal,
    extract(epoch from (coalesce(sh.exited_at, now()) - sh.entered_at))::float8 as elapsed_s,
    analytics_held_seconds(sh.quote_id, sh.entered_at, coalesce(sh.exited_at, now())) as held_s
  from quote q
  left join stage_definition sd on sd.key = sh.stage_key
  where q.id = sh.quote_id
) aq on true;

comment on view analytics_stage_stay is
  'BUSINESS DEFINITION: one row per stay of a quote in a workflow stage (stage_history). elapsed_s is wall-clock time in the stay (an open stay runs to now). held_s is the recorded customer/internal hold time inside the stay (quote_hold). active_s = elapsed_s - held_s is the CYCLE TIME: time in stage excluding recorded holds (CR-55, CR-57). A rework or return creates a new stay, so a quote can have several stays in one stage; medians are per stay. Terminal stages (is_terminal) are never "in progress" and are excluded from cycle times and WIP. Open stays use now(), so only completed stays (exited_at is not null) give reproducible answers.';
grant select on analytics_stage_stay to ccq_app, ccq_migrator, ccq_readonly;
