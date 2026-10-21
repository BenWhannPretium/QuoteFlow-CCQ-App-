drop view if exists analytics_quote cascade;
create view analytics_quote with (security_invoker = true) as
select
  q.id                         as quote_id,
  q.quote_number,
  q.kam_user_id,
  k.display_name               as kam_name,
  q.region,
  q.market,
  q.product_family,
  q.stage_key,
  sd.label                     as stage_label,
  sd.sort                      as stage_sort,
  coalesce(sd.terminal, false) as is_terminal,
  q.status,
  q.version,
  q.priority_tier,
  q.priority_score,
  q.created_at,
  q.submitted_at,
  q.closed_at,
  q.outcome,
  q.outcome_reason_code,
  q.proposal_issued_at,
  q.validity_until,
  q.assigned_engineer_id,
  e.display_name               as assigned_engineer_name,
  q.assigned_at,
  s.amount                     as sf_amount,
  q.est_annual_revenue,
  -- B-26: the customer's answer. A quote awarded at G5 and still in Commit & Hand Off is a customer
  -- award (its commitment is pending), so it counts as 'awarded' here before G6 closes it.
  case
    when q.outcome in ('awarded', 'lost', 'expired') then q.outcome
    when q.status <> 'closed' and q.stage_key = 'COMMIT_HANDOFF' then 'awarded'
  end                          as customer_outcome,
  -- Customer outcome state (G5): 'recorded' = awarded / lost / expired (B-26: including awards waiting
  -- in Commit & Hand Off); 'open' = still waiting in Customer Decision. Internal closures (declined,
  -- redirected, not authorized) are neither: they never reached the customer or are not its answer.
  case
    when q.outcome in ('awarded', 'lost', 'expired') then 'recorded'
    when q.status <> 'closed' and q.stage_key = 'COMMIT_HANDOFF' then 'recorded'
    when q.status <> 'closed' and q.stage_key = 'CUSTOMER_DECISION' then 'open'
  end                          as outcome_state,
  case
    when q.outcome in ('awarded', 'lost', 'expired')
      or (q.status <> 'closed' and q.stage_key in ('CUSTOMER_DECISION', 'COMMIT_HANDOFF'))
    then coalesce(q.proposal_issued_at, q.closed_at, q.created_at)
  end                          as outcome_cohort_at
from quote q
left join app_user k on k.id = q.kam_user_id
left join app_user e on e.id = q.assigned_engineer_id
left join stage_definition sd on sd.key = q.stage_key
left join sf_opportunity_snapshot s on s.sf_opportunity_id = q.sf_opportunity_id;

comment on view analytics_quote is
  'BUSINESS DEFINITION: one row per CCQ quote with the dimensions every metric slices by (KAM, region, market, product family, stage, priority tier) and its close-out. sf_amount is the Salesforce opportunity amount AS ENTERED (not validated, not a price). customer_outcome is the customer answer (awarded, lost, expired; an award still in Commit & Hand Off counts as awarded). outcome_state is the customer-outcome cohort: recorded (awarded, lost or expired decided at G5) or open (waiting in Customer Decision); outcome_cohort_at is when that proposal was issued (falling back to the close date), the date the Outcomes metrics window on. Operational metrics from QuoteFlow; not yet D&A-certified.';
grant select on analytics_quote to ccq_app, ccq_migrator, ccq_readonly;
