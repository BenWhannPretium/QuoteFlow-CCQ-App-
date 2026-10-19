drop view if exists analytics_gate_decision cascade;
create view analytics_gate_decision with (security_invoker = true) as
select
  g.id            as decision_id,
  g.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  g.gate_key,
  g.outcome_key,
  g.decided_by,
  du.display_name as decided_by_name,
  g.decided_at,
  g.reason_code,
  g.target_stage_key,
  g.quote_version,
  g.quote_version < aq.version as superseded,
  g.note
from gate_decision g
join analytics_quote aq on aq.quote_id = g.quote_id
left join app_user du on du.id = g.decided_by;

comment on view analytics_gate_decision is
  'BUSINESS DEFINITION: one row per recorded gate decision (G1 qualify, G2 feasibility, G3 price/capital, G4 release, G5 outcome), with who decided, the outcome and reason code, and the quote dimensions. superseded = the decision was taken on an earlier quote version (a later rework, return or re-quote bumped the version); decisions are kept, never edited (CR-38). Feeds G1 qualification yield (S-04), the reasons work is returned to the KAM, and Final Review decisions.';
grant select on analytics_gate_decision to ccq_app, ccq_migrator, ccq_readonly;
