# 06: First week after go-live

A daily checklist for the first seven days of QuoteFlow in production, with the exact query for each check and the number that means "act". It is for whoever holds first response that week (the Embedded Intelligence builder, with an Admin). Written 2026-11-17 during the pre-release audit from the code and schema on branch `claude/audit-prerelease`. No query here was run against production; the thresholds are starting points to tune after week one.

## 0. Read this first

**The app has no telemetry SDK.** Its only output is JSON lines on stdout (pino). Three things must be true before the log queries in section 2 return anything:

1. The logging fix is deployed (commit `5262040`). Before it every line carried `"err":{}`, `"req":{}`, `"res":{}`.
2. The diagnostic setting is applied: `param sendAppLogsToLogAnalytics = true` in `infra/main.prod.bicepparam`, then `what-if`, then apply (`infra/modules/diagnostics.bicep`, commit `000d2d7`; written, linted, never applied; `infra/README.md` says to try it on test first). It sends `AppServiceConsoleLogs` to workspace `log-quoteflow-prod`.
3. You have Log Analytics Reader on that workspace.

**Until then, the fallback** is the App Service file system: portal → web app → **Log stream**, or `az webapp log tail -n quoteflow-prod -g rg-ccq-prod`. It holds 35 MB or 7 days, whichever comes first, and cannot be queried. Search it by eye for `"level":50` (error), `"level":40` (warning) and `refusing to start`. The SQL in section 3 and the Admin pages need none of this.

**Alerts email nobody** (`alertEmails = []`). Until an address is set, open **Monitor → Alerts** yourself, every day.

**Treat the logs as commercially sensitive.** Read from the code, not observed: when a database statement fails, the logged `err.message` and `err.stack` contain the SQL text and its bound values (Drizzle's `DrizzleQueryError` builds its message as `Failed query: … params: …`), and the error's `params` property is logged too. That was found while this document was being written and **fixed the same day** (commits `4902a0a`, `f305397`): the logged error now reads "Failed query (statement and parameters withheld; see cause)", the statement, its values and Postgres's `detail` are dropped at every level, and a quoted value in a data-exception message is replaced. The cause chain is kept as nested objects, and the SQLSTATE is on `err.code`. Still limit who can read the Log stream and the workspace: paths carry quote numbers, and a message written by application code could name a customer. The queries below never project `err.message`.

## 1. The daily list (15 minutes, each morning US Central)

| # | Look at | Where | Act when |
|---|---|---|---|
| 1 | Health | `https://quoteflow-prod.azurewebsites.net/api/v1/health` | Not `200` / `"db":"up"`, or `version` is not the commit you expect |
| 2 | Fired alerts | Portal → Monitor → Alerts, scope `rg-ccq-prod` | Any fired rule. `quoteflow-prod-http5xx` fires above 10 in 15 minutes; `-availability` when 2 of 5 locations fail. |
| 3 | Availability test | Portal → `appi-quoteflow-prod` → Availability | Any failed run that is not a deploy window |
| 4 | Connectors | `/admin/integrations` | `salesforce` not `ok`, or last success older than 45 minutes |
| 5 | Admin alerts | The bell, signed in as an Admin | Any "Salesforce sync failed" notice |
| 6 | 5xx, errors, job failures | Queries 2.1, 2.3, 2.6 | See each query |
| 7 | Start-up and restarts | Query 2.8 | A restart nobody caused; any `refusing to start` |
| 8 | Stuck work | SQL 3.1, 3.2 | See each query |
| 9 | Integration runs | SQL 3.3, 3.4 | See each query |
| 10 | Audit is being written | SQL 3.6 | Any row from the second query |
| 11 | User reports | `/admin/feedback` | Any severity 1 or 2 still `new` after one working day |
| 12 | Config changes | `/admin/decision-log` | A change you did not expect, or one with a careless reason |

**Day 1 only:** run section 4 in full; confirm who holds each role (4.5). **Day 3 and day 7:** queries 2.2 (slow routes), 2.4 and 2.5 (auth and rate limits), SQL 3.5 (email outbox), 3.7 and 3.8, and section 4 again. **Day 7:** write down the numbers; they are the baseline.

## 2. Log queries (KQL, Log Analytics workspace `log-quoteflow-prod`)

Table `AppServiceConsoleLogs`: `TimeGenerated`, `ResultDescription` (the log line), `Level`, `_ResourceId`. The JSON fields used below are the ones the API writes: `level` (pino: 30 info, 40 warn, 50 error, 60 fatal), `msg`, `reqId`, `req.method`, `req.url` (path only, no query string), `req.remoteAddress`, `res.statusCode`, `responseTime` (milliseconds), `err.type`, `err.code`, `component`, `pgCode`, `code`.

A request writes two lines: `incoming request` (with `req`) and `request completed` (with `res` and `responseTime`). They share `reqId`, which is also the `traceId` a user sees in an error and `audit_event.request_id`. The log does not say which user made a request.

**Paste this block above every query in this section.**

```kusto
let lookback = 24h;
let L = AppServiceConsoleLogs
  | where TimeGenerated > ago(lookback)
  | where _ResourceId has "quoteflow-prod"
  | extend j = parse_json(ResultDescription)
  | where isnotnull(j.level);                    // the API's JSON lines only
let Req = L
  | where tostring(j.msg) == "incoming request"
  | project reqId = tostring(j.reqId), method = tostring(j.req.method),
            url = tostring(j.req.url), ip = tostring(j.req.remoteAddress);
let Requests = L
  | where tostring(j.msg) == "request completed"
  | project TimeGenerated, reqId = tostring(j.reqId),
            status = toint(j.res.statusCode), ms = todouble(j.responseTime)
  | join kind=inner Req on reqId
  | extend route = replace_regex(url, @"CCQ-\d{4}-\d{5}", ":quoteNumber")
  | extend route = replace_regex(route, @"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", ":id")
  | extend route = replace_regex(route, @"/(opportunities|erf)/[^/]+", @"/\1/:id");
```

If `j` comes back empty for lines that look like JSON, App Service has put a prefix on the line; that is not verified from the repo. Check one raw `ResultDescription` first.

### 2.1 5xx by route

```kusto
Requests
| where status >= 500
| summarize n = count(), last = max(TimeGenerated), sample = take_any(reqId) by method, route, status
| order by n desc
```

**Act:** any 5xx on a write (`POST`, `PUT`, `PATCH`, `DELETE`): find the cause the same day. Any route with 3 or more in a day. A `503` on `/api/v1/health` means the database was unreachable. Use `sample` as `reqId` in 2.3 to find the error line.

### 2.2 Slowest routes (p95)

```kusto
Requests
| where route startswith "/api/"
| summarize n = count(), p50 = percentile(ms, 50), p95 = percentile(ms, 95), worst = max(ms) by method, route
| where n >= 20
| order by p95 desc
```

**Act:** p95 above 1000 ms on a read route. The target is p95 under 400 ms (`01-architecture.md` §9). Expect these to be slow by design and ignore them: uploads, `export.csv`, the offer letter, `POST /api/v1/admin/salesforce/sync` (waits up to 25 s), `POST /api/v1/admin/pricing-history/import`, and `/api/v1/salesforce/opportunities…` (live Salesforce; up to four 20-second tries when Salesforce is failing).

### 2.3 Errors by type and code

```kusto
L
| where toint(j.level) >= 50
| summarize n = count(), last = max(TimeGenerated), sample = take_any(tostring(j.reqId))
    by msg = tostring(j.msg), type = tostring(j.err.type), code = tostring(j.err.code),
       component = tostring(j.component)
| order by n desc
```

**Act:** any `unhandled error` (that is a 500). A database failure shows `type` = `DrizzleQueryError` with the SQLSTATE in `code` (lifted from the driver's error, which is under `err.cause` with its table, column and constraint; the statement and its values are withheld). To read one error, filter `L` on `tostring(j.reqId) == "<id>"` and open the line.

### 2.4 Sign-in and permission failures (401, 403)

```kusto
Requests
| where status in (401, 403)
| summarize n = count(), addresses = dcount(ip) by status, route, bin(TimeGenerated, 1h)
| order by TimeGenerated desc, n desc
```

**Act:** every API call answering 401 for everyone: an `ENTRA_*` setting is wrong, or the API could not fetch Entra's signing keys (that also shows as 401 "Token is invalid" and logs nothing: `apps/api/src/auth/entra.ts`). A steady 403 on one route: a role is missing a permission it expects, or the user has no `CCQ.*` role. A handful of 401s per user per day is normal (expired tokens). The log does not record why a token was refused.

### 2.5 Rate limiting (429)

```kusto
Requests
| where status == 429
| summarize n = count() by ip, route, bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

**Act:** any 429 during normal use. The limit is `RATE_LIMIT_MAX` (300) requests a minute per signed-in user, per address for rejected sign-ins and public routes. A screen that hits it has a request loop.

### 2.6 Background-job and connector failures

```kusto
L
| where isnotempty(j.component) and toint(j.level) >= 40
| summarize n = count(), last = max(TimeGenerated)
    by component = tostring(j.component), level = toint(j.level), msg = tostring(j.msg), code = tostring(j.code)
| order by level desc, n desc
```

| `component` | `msg` | Act when |
|---|---|---|
| `salesforce` | `sf sync failed`, `sf sync could not start` | 2 in a row (30 minutes) |
| `salesforce` | `sf sync: page failed` | Any: one bad record drops its page on every run and the run ends `partial`, which alerts nobody |
| `salesforce` | `sf live read failed; using snapshot`, `sf live search failed; snapshot results only` | More than 10 an hour |
| `validity-expiry` | `validity expiry failed` | Any (the job runs once a day) |
| `notification-dispatch` | `email dispatch failed`, `email delivery failed after every retry` | Any, once dispatch is on (it is off in prod today) |
| `fabric-mirror` | `fabric mirror unhealthy`, `fabric mirror check could not run` | Any, once the mirror exists |
| `attachments` | `file store failed`, `upload stored but not recorded; file moved to removed` | 3 or more a day |
| `admin-config` | `scoring rescore failed`, `scoring rescore batch failed` | Any |

### 2.7 Database errors answered as 4xx

```kusto
L
| where tostring(j.msg) == "database error answered as 4xx"
| extend reqId = tostring(j.reqId), pgCode = tostring(j.pgCode)
| join kind=leftouter Req on reqId
| summarize n = count(), last = max(TimeGenerated) by pgCode, method, url
| order by n desc
```

These were bare 500s before commit `6772adb`. `23505` and `23503` are a double submit or two people on one record (409). `40001` and `40P01` are two colliding transactions (409, retry). Class `22` is a value that did not fit its column (400). **Act:** more than 5 a day of one code on one route, or any `40P01`: a known cause is section saves that do not take the quote lock (`04-needs-ben.md` N-12). Any class `22` means a request schema let through something the column refuses: fix the schema.

### 2.8 Start-up failures and restarts

```kusto
AppServiceConsoleLogs
| where TimeGenerated > ago(7d) and _ResourceId has "quoteflow-prod"
| where ResultDescription has "refusing to start"
     or ResultDescription has "database preparation failed"
     or ResultDescription has "Invalid configuration"
     or ResultDescription has "[quoteflow-start]"
     or ResultDescription has "Server listening"
| project TimeGenerated, ResultDescription
| order by TimeGenerated desc
```

The start-up lines are plain text, not JSON, and the reason is on the line after `refusing to start`. **Act:** any `refusing to start` (`05-release-runbook.md` 2.2). More `Server listening` lines in a day than deploys plus setting changes: the platform restarted the app; check plan CPU and memory in the portal.

## 3. Database checks (SQL, database `ccq`)

Table and column names are from `packages/db/src/schema`. Stage keys (`CUSTOMER_DECISION`, `AWARDED`) and gate keys (`G6`) are the seeded hybrid model's. Getting a session: `05-release-runbook.md` section 5. Start each session with `begin read only;`. The admin login sees every row.

### 3.1 Quotes sitting in a stage

```sql
select q.quote_number, q.stage_key, sh.entered_at,
       round(extract(epoch from (now() - sh.entered_at)) / 86400.0, 1) as days_in_stage
from quote q
join stage_history sh on sh.quote_id = q.id and sh.exited_at is null
where q.status = 'active'
  and sh.entered_at < now() - interval '5 days'
order by sh.entered_at;
```

**Act:** any row. Five calendar days is a starting number, not an SLA: none is agreed (`sla_hours_by_stage` is null). Tell the gate owner; an Admin cannot move a quote (`07-admin-support.md` §5).

### 3.2 On hold past the review date

```sql
select q.quote_number, q.stage_key, q.review_date, h.started_at, h.reason_code, q.hold_owner_id
from quote q
left join quote_hold h on h.quote_id = q.id and h.ended_at is null
where q.status = 'on_hold'
  and (q.review_date is null or q.review_date < (now() at time zone 'America/Chicago')::date)
order by q.review_date nulls first;
```

**Act:** any row. Nothing in the app reminds the hold owner. A hold ends only when the gate's decider records another decision.

### 3.3 Integration runs that failed or never finished

```sql
select id, source, status, started_at, finished_at, error
from integration_run
where started_at > now() - interval '24 hours'
  and (status in ('failed', 'partial')
       or (status = 'running' and started_at < now() - interval '30 minutes'))
order by started_at desc;
```

**Act:** 2 or more `failed` Salesforce runs in a row; any `partial`; any `running` row older than 30 minutes. A run cut off by a restart stays `running` for good: it is a stale row, not a live job. Note it and move on.

### 3.4 Last successful Salesforce sync

```sql
select max(started_at) as last_success_started, now() - max(started_at) as age
from integration_run
where source = 'salesforce' and status = 'succeeded';
```

**Act:** `age` over 45 minutes (three missed 15-minute runs). Only a `succeeded` run moves the sync's watermark.

### 3.5 Email outbox

```sql
select
  count(*) filter (where failed_at is not null)                               as failed,
  count(*) filter (where sent_at is null and failed_at is null
                   and next_attempt_at is not null)                           as queued,
  count(*) filter (where sent_at is null and failed_at is null
                   and next_attempt_at is not null
                   and created_at < now() - interval '24 hours')              as queued_over_24h,
  count(*) filter (where error like 'skipped:%')                              as skipped,
  min(created_at) filter (where sent_at is null and failed_at is null
                          and next_attempt_at is not null)                    as oldest_queued
from notification
where channel = 'email';
```

Dispatch is off in prod (`NOTIFICATION_DISPATCH_INTERVAL_SECONDS = 0`) while the setting `email_notifications_enabled` is seeded `true`, so `queued` grows every day and nothing is sent. That is expected. **Act:** any `failed` once dispatch is on. Before turning dispatch on, read `queued` and `queued_over_24h`: rows older than 24 hours are skipped, the rest go out at 50 a minute.

### 3.6 Audit volume, and decisions without an audit row

```sql
select (at at time zone 'America/Chicago')::date as day,
       count(*) as events,
       count(*) filter (where action = 'sign_in')       as sign_ins,
       count(*) filter (where action = 'view')          as views,
       count(*) filter (where action in ('gate_decision', 'stage_change')) as decisions,
       count(distinct actor_id)                         as users
from audit_event
where at > now() - interval '14 days'
group by 1 order by 1 desc;

select q.quote_number, gd.gate_key, gd.outcome_key, gd.decided_at
from gate_decision gd
join quote q on q.id = gd.quote_id
where gd.decided_at > now() - interval '14 days'
  and not exists (
    select 1 from audit_event a
    where a.quote_id = gd.quote_id
      and a.action in ('gate_decision', 'stage_change')
      and a.at = gd.decided_at
      and a.after ->> 'gateKey' = gd.gate_key)
order by gd.decided_at desc;
```

A decision writes one audit row in its own transaction, at the same instant: `stage_change` when the quote moves, `gate_decision` when it stays. **Act:** any row from the second query (it should be impossible; it is a defect against rule 3). A working day with users but zero `view` rows: the best-effort view audit is failing (log line `view audit failed (best effort)`).

### 3.7 Quotes created per day

```sql
select (created_at at time zone 'America/Chicago')::date as day, count(*) as quotes
from quote
where created_at > now() - interval '14 days'
group by 1 order by 1 desc;
```

**Act:** zero on a working day after the pilot has started, or a day far above the others (a retry loop or a bulk test).

### 3.8 Expired proposals the job has not flagged

```sql
select quote_number, validity_until, proposal_issued_at
from quote
where stage_key = 'CUSTOMER_DECISION'
  and status <> 'closed'
  and validity_until is not null
  and validity_until < (now() at time zone 'America/Chicago')::date - 1
  and validity_expired_flagged_at is null
order by validity_until;
```

**Act:** any row. The job runs a minute after each start and then every 24 hours, so one day of lag is normal; more means it is failing (2.6) or `VALIDITY_EXPIRY_INTERVAL_HOURS` is 0.

## 4. Business sanity checks

| # | Check | Query | Expect |
|---|---|---|---|
| 4.1 | Every quote is linked to a Salesforce opportunity (rule 6) | `select count(*) as quotes, count(distinct sf_opportunity_id) as opportunities, count(*) filter (where sf_opportunity_id is null) as unlinked from quote;` | `unlinked` = 0. Compare `quotes` with the count the sales leaders expect from their Salesforce report for the same days: a manual comparison. |
| 4.2 | Every closed quote has an outcome, a reason and an owner | `select quote_number, stage_key from quote where status = 'closed' and (outcome is null or outcome_reason_code is null or closure_owner_id is null or closed_at is null);` | No rows (a CHECK constraint also enforces it) |
| 4.3 | Closed – Won only through G6 | `select q.quote_number from quote q where q.stage_key = 'AWARDED' and not exists (select 1 from gate_decision gd where gd.quote_id = q.id and gd.gate_key = 'G6');` | No rows |
| 4.4 | Open quotes whose opportunity closed or was deleted in Salesforce | `select quote_number, stage_key, sf_status_flag, sf_status_flagged_at from quote where status <> 'closed' and sf_status_flag is not null;` | Each one has a KAM who knows |
| 4.5 | Who holds which role | `select r.role, count(*) from user_role r join app_user u on u.id = r.user_id where u.active group by r.role order by 1;` | Matches the pilot list. Any `Admin` or `Approver` you cannot name is a UAT grant that works in prod (shared `CCQ.` prefix). The table only knows people who have signed in. |
| 4.6 | Outcomes recorded this week | `select outcome, outcome_reason_code, count(*) from quote where closed_at > now() - interval '7 days' group by 1, 2 order by 3 desc;` | Reasons a sales leader recognises; no single catch-all reason on everything |
| 4.7 | Config changed since go-live | `select at, entity, entity_id, change_reason from audit_event where action = 'config_change' and at > now() - interval '7 days' order by at desc;` | Each change is one you can explain (same data as `/admin/decision-log`) |
