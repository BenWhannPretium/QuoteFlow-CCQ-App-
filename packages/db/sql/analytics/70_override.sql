drop view if exists analytics_override cascade;
create view analytics_override with (security_invoker = true) as
select
  o.id          as override_id,
  o.quote_id,
  aq.quote_number,
  aq.kam_user_id,
  aq.region,
  aq.market,
  aq.product_family,
  o.field,
  o.status,
  o.approval_mode,
  o.requested_by,
  ru.display_name as requested_by_name,
  o.decided_by,
  du.display_name as decided_by_name,
  o.created_at    as requested_at,
  o.decided_at,
  o.applied_at
from override o
join analytics_quote aq on aq.quote_id = o.quote_id
left join app_user ru on ru.id = o.requested_by
left join app_user du on du.id = o.decided_by;

comment on view analytics_override is
  'BUSINESS DEFINITION: one row per governed override request (priority tier, ship-to, queue position). requested_at is when it was asked for; decided_by is the approver (or the requester for a self-approved field). Override frequency = requests per field and per approver in a window, against the number of quotes created in the same window.';
grant select on analytics_override to ccq_app, ccq_migrator, ccq_readonly;
