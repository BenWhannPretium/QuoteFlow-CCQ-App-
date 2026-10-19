drop view if exists analytics_gate_compliance cascade;
create view analytics_gate_compliance with (security_invoker = true) as
select
  aq.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  aq.proposal_issued_at,
  exists (select 1 from gate_decision g where g.quote_id = aq.quote_id and g.gate_key in ('G1', 'SUBMIT')) as has_g1,
  exists (select 1 from gate_decision g where g.quote_id = aq.quote_id and g.gate_key = 'G2') as has_g2,
  exists (select 1 from gate_decision g where g.quote_id = aq.quote_id and g.gate_key = 'G3') as has_g3,
  exists (select 1 from gate_decision g where g.quote_id = aq.quote_id and g.gate_key = 'G4') as has_g4
from analytics_quote aq
where aq.proposal_issued_at is not null;

comment on view analytics_gate_compliance is
  'BUSINESS DEFINITION (S-08): gate compliance. One row per quote whose proposal was issued. has_g1..has_g4 = at least one gate decision is recorded for that gate (the G1 column also accepts the SUBMIT gate used when G1 is switched off). A quote is compliant when all four are true. Quotes created in QuoteFlow cannot reach a proposal without them, so anything below 100% is imported, backfilled or migrated data.';
grant select on analytics_gate_compliance to ccq_app, ccq_migrator, ccq_readonly;
