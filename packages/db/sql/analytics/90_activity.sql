drop view if exists analytics_user_activity_weekly cascade;
create view analytics_user_activity_weekly with (security_invoker = true) as
select
  analytics_week(a.at) as week,
  r.role,
  a.actor_id,
  count(*)::int        as events
from audit_event a
cross join lateral unnest(a.actor_roles) as r(role)
where a.actor_id is not null
group by 1, 2, 3;

comment on view analytics_user_activity_weekly is
  'BUSINESS DEFINITION (S-10 adoption): one row per user, role held at the time and US Central week, with their audit-event count. A user is ACTIVE in a week when they have at least one audit event (any view, create or decision) in it. Weekly active users by role = count of rows per week and role. A user holding several roles counts once under each role. Readable only to audit.read holders (audit_event row-level security).';
grant select on analytics_user_activity_weekly to ccq_app, ccq_migrator, ccq_readonly;

drop view if exists analytics_intake_created cascade;
create view analytics_intake_created with (security_invoker = true) as
select
  a.at,
  analytics_week(a.at) as week,
  a.actor_id,
  a.quote_id
from audit_event a
where a.action = 'create' and a.entity = 'quote';

comment on view analytics_intake_created is
  'BUSINESS DEFINITION (S-10): one row per intake submitted in QuoteFlow (audit action create on a quote, written when a draft is submitted). Counted per US Central week. Intakes still raised outside QuoteFlow (the legacy ERF flow) are invisible here by construction. Readable only to audit.read holders.';
grant select on analytics_intake_created to ccq_app, ccq_migrator, ccq_readonly;
