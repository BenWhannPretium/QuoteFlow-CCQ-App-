drop view if exists analytics_quote_cycle cascade;
create view analytics_quote_cycle with (security_invoker = true) as
select
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  st.started_at,
  rel.released_at,
  extract(epoch from (rel.released_at - st.started_at))::float8 as elapsed_s,
  analytics_held_seconds(aq.quote_id, st.started_at, rel.released_at) as held_s,
  greatest(
    extract(epoch from (rel.released_at - st.started_at))
      - analytics_held_seconds(aq.quote_id, st.started_at, rel.released_at), 0)::float8 as active_s
from analytics_quote aq
join lateral (
  select min(sh.entered_at) as started_at
  from stage_history sh where sh.quote_id = aq.quote_id and sh.stage_key = 'INTAKE'
) st on st.started_at is not null
join lateral (
  select min(g.decided_at) as released_at
  from gate_decision g
  where g.quote_id = aq.quote_id and g.gate_key = 'G4' and g.outcome_key = 'approve'
) rel on rel.released_at is not null;

comment on view analytics_quote_cycle is
  'BUSINESS DEFINITION (S-01/S-02): end-to-end cycle time from intake to release, one row per quote that has a G4 Approve. started_at = first entry into Intake (the KAM submitted the request); released_at = the first G4 Approve (the internal go-ahead to issue the proposal). active_s = elapsed_s minus ALL recorded holds in between (CR-57); time a quote spends back with the KAM after a Rework stays in, because that is part of how long the customer waits. It stops at G4: customer decision time is excluded by design.';
grant select on analytics_quote_cycle to ccq_app, ccq_migrator, ccq_readonly;
