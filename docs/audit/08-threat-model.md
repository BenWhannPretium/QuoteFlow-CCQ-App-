# 08: Threat model

A short threat model of QuoteFlow as deployed to production on 2026-11-17: what is worth protecting, where trust changes hands, the STRIDE threats at each boundary, the control that answers each one, and what risk is left. It is for the app owner, IT security and anyone reviewing the release. Written during the pre-release audit from the code, Bicep and workflows on branch `claude/audit-prerelease`. Controls that live in Azure, Entra, GitHub, Salesforce or Fabric settings are named but **not verified from the repo**.

## 1. Assets

| Asset | Where | Why it matters |
|---|---|---|
| Commercial figures: prices, margin, capital, payback models, offer letters, imported pricing history | Postgres (`quote`, `pricing_record`, `pricing_history_record`, `offer_letter`), Blob container `attachments` | Customer-confidential; visible to every role that can read the quote (rule 2) |
| Gate decisions and the audit trail | `gate_decision`, `audit_event`, `activity_event` | The record of who approved what; must not be alterable |
| Salesforce copy (about 32,000 opportunities and their accounts) | `sf_opportunity_snapshot`, `customer` | The whole pipeline, read as one integration user |
| Secrets: database admin connection string, Salesforce consumer secret | Key Vault `database-url`, `sf-client-secret` | Full data access; Salesforce read access |
| Identity and roles | Entra app roles `CCQ.*`, groups `SG-CCQ-*`, `user_scope` | Decide who can approve and who sees what |
| Configuration | Config tables (gates, required fields, scoring, settings) | Changes the process for everyone |
| The deploy path | GitHub repo, `production` environment, identity `id-quoteflow-deploy-prod` | Whoever controls it controls the code in prod |

## 2. Trust boundaries, threats, controls, residual risk

S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege.

| # | Boundary | Threat | Control | Residual risk |
|---|---|---|---|---|
| 1 | Browser → App Service front end → API (public URL) | **S** forged or replayed token | `apps/api/src/auth/entra.ts`: `jose` verifies signature (tenant JWKS), issuer, audience, RS256 only, expiry with 60 s tolerance, the `access_as_user` scope and an `oid`. `AUTH_MODE=dev` is refused when `NODE_ENV=production` or `APP_ENVIRONMENT=prod` (`config.ts`). | A failure to fetch the signing keys answers 401 "Token is invalid" and logs nothing, so an Entra outage looks like bad tokens. |
| | | **E** a user does more than their role allows | Every route declares a permission or the app refuses to boot (`plugins/auth.ts`); checks go through `packages/domain/src/policy`; every role is sent at every route in `apps/api/test/permissions/matrix.int.test.ts`; segregation rules in the gate engine. | **Test and prod honour the same role prefix `CCQ.`**: a role granted for UAT, including Admin and Approver, works in prod (R-2). |
| | | **I** a user reads quotes outside their scope | Second layer in SQL: every request runs in `withRequestContext` (`SET LOCAL ROLE ccq_app` plus `app.user_id`, `app.roles`, `app.scope_*`), with RLS forced on quote tables and `sf_opportunity_snapshot`. | Sees-all roles are **not** narrowed by RLS when an Admin gives them a `region` or `account_list` scope; only the domain policy narrows their lists (R-5). `PostAward` can read all pricing history (`04` N-10). |
| | | **I** script injection, framing, leaked internals | CSP in `app.ts` (helmet): `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`, `connect-src` limited to self and Entra. HTTPS only, TLS 1.2 (Bicep). 5xx bodies carry no detail (`plugins/problem-json.ts`). No Swagger in production. | **Source maps are served publicly** (`vite.config.ts` `sourcemap: true`): the SPA's source, not secrets (R-7). CSP in a signed-in production session was not exercised. |
| | | **D** flooding | `@fastify/rate-limit`: 300 requests a minute per signed-in user; per address for public routes and rejected sign-ins (`clientIp.ts` strips the port; one trusted proxy hop; the limiter is scoped by the matched route, so a percent-encoded path cannot side-step it). Uploads: one file, 100 MB cap. `/health` ping is bounded. | One B1 instance. `/health` is unlimited by design. No WAF or front door in the Bicep. Transactions are held across file-store calls, so a slow store can pin pool connections (R-8). |
| | | **T** bad input reaching the database | zod schema on every route; impossible dates and non-id filters refused as 400 (`3497333`); NUL characters refused; database collisions and values that do not fit their column answered as 409 / 400 from an allow-list, never echoed; every other database error stays a 500 (`services/pg-error.ts`). | Section saves do not take the quote lock: a save can land just after a gate decision (`04` N-12). |
| | | **R** a user denies an action | `audit_event` written in the same transaction as each decision, override, upload, export and config change, with roles, address and request id. | Reading the offer letter and pricing history is not audited. Quote views are best-effort. |
| 2 | API → Postgres | **E / T** the app's own login is over-privileged | Requests drop to `ccq_app` per transaction; RLS is forced; `audit_event` and `activity_event` have UPDATE, DELETE and TRUNCATE revoked from `ccq_app` and blocked by trigger (migration `0004`). | **The runtime login is the server admin and table owner** (one `DATABASE_URL` for migrations and requests). A query written outside `withRequestContext` sees every row, and that login could disable the audit triggers (R-1). |
| | | **I / S** network reach to the database | TLS required (`require_secure_transport`); password in Key Vault only. | Public endpoint with "Allow Azure services": any Azure tenant can reach the server, so it rests on the admin password and TLS alone (decided 2026-11-12). |
| | | **D** loss or corruption | PITR, 35 days (`main.prod.bicepparam`). Migrations are transactional and serialized by an advisory lock (`migrate.ts`). | **Geo-redundant backup is off** and can only be chosen at server creation; HA is off (R-9). No restore test has been run. Migration `0047` cannot be rolled back across (`05` §6). |
| 3 | API → Salesforce | **T / E** writing to the system of record | Read-only integration user; the connector only issues SOQL reads (`packages/integrations`); rule 5. | The integration user's permission set is not verified from the repo. |
| | | **I** a user sees opportunities outside their scope | Snapshot under RLS (`app_opportunity_visible`); live results pass the same SQL function before being returned or stored (`services/salesforce.ts`). | **The live Salesforce lookup happens before the visibility check**: any reader can make the app call Salesforce for ids it then hides. It spends API quota and is a timing signal (R-6). |
| | | **S / I** stolen consumer secret | Key Vault reference; never logged (`logger.ts` masks `secret`, `token`, `password` keys). | Test and prod use the same connected app and the same secret. An unresolved reference is not caught at start-up. |
| | | **D** Salesforce slow or down | Falls back to the snapshot; sync failures alert Admins in-app. | Interactive paths retry four times at 20 s each before falling back. |
| 4 | API → Graph (SharePoint, mail) and Blob | **I / T** file access outside the app | Managed identity, no stored credential in prod (`GRAPH_CLIENT_SECRET` refused); private container, no public blob access; downloads go through an audited route with a quote-level check. Prod stores to Blob today; mail dispatch is off. | Storage account has a public endpoint (RBAC and TLS only). When SharePoint and mail are turned on: `Sites.Selected` and the Exchange access policy are IT settings, not verified. |
| | | **D** slow or throttled store | Each Graph request now times out (`a34494d`). | **Database transactions are held across file-store calls** (offer letter, download link, removal) (R-8). |
| 5 | API / Postgres → Fabric | **I** commercial data copied to a wider audience | Not connected in prod (Fabric ids empty). Design: D&A-owned workspace, security rebuilt in Fabric (`01-architecture.md` §6.1). | When it starts: the mirror copies every table, including commercial columns and the Salesforce copy; Postgres RLS does **not** carry over; reads there are audited by Fabric, not `audit_event`. The mirror needs replication rights on the admin login. |
| 6 | GitHub Actions → Azure | **S / E** someone else deploys to prod | OIDC federated credential bound to `repo:…:environment:production`; no stored cloud secret; the identity holds Website Contributor on the one web app (`rbac.bicep`); workflow refuses unless the target is `rg-ccq-prod`, CI passed on the SHA and the SHA is on `main`. | The environment's required reviewer is the repo owner with self-approval (per `03` B-22; not verified). Actions are pinned to major tags, not commit hashes, in a job with `id-token: write`. Anyone who can push a `v*` tag reaches the approval prompt. |
| | | **T** a poisoned dependency or leaked secret in the build | `pnpm install --frozen-lockfile`; `pnpm audit` (high and critical) and gitleaks on every CI run. | Moderate advisories in runtime dependencies remain (`04` N-15). |
| 7 | Admin console → configuration | **T / E** an Admin (or a stolen Admin session) changes the process | Writes need `config.manage` (Admin only), a row version, a reason, and pass the domain validators; each is an `audit_event` with before and after; who decides a gate is code, not config; roles cannot be edited in the app. | An Admin can still weaken a gate (remove a required field, switch G1 off) in one audited step with no second approver. Required-field rules accept unknown field names. |
| | | **D** a bad value takes the app down | Every seeded setting now has a validating spec, with a guard test (`de764ba`). | `intake_required_fields` can still be emptied (`04` N-15). |
| 8 | Operators → logs and portal | **I** data in logs | Log lines carry ids, codes and counts; `logger.ts` masks keys matching price, token, margin, secret, password; request lines carry path only, no query string, headers or body. | **New, found while writing this:** a failed database statement is logged with its SQL text and bound values in `err.message`, `err.stack` and `err.params` (Drizzle's error; `logger.ts` strips `query` and `parameters` but not these). Read from the code, not observed; fixed the same day (R-4). |
| | | **R / D** an incident nobody sees | Platform metric alerts and an availability test on `/health` (`alerts.bicep`). | **No application telemetry** (no SDK reads the App Insights connection string) and **alerts have no receivers** (`alertEmails = []`). Logs live 7 days / 35 MB on the instance unless the new diagnostic setting is applied (R-3). |

## 3. Residual risks the audit did not close

Ranked by what to settle first. `04-needs-ben.md` has the recommendation for each.

| # | Risk | Likelihood, impact | Closing it |
|---|---|---|---|
| R-1 | Runtime database login is the admin and table owner | Low likelihood (needs a coding slip or a stolen connection string); impact is total: all rows, and the audit triggers | A separate login that can only become `ccq_app`; keep the admin URL for start-up migrations |
| R-2 | Test and prod share the role prefix `CCQ.` | High likelihood during UAT; a tester holds Approver or Admin in prod | Review role assignments now; move test to `CCQ.Test.` (`06` A8a) |
| R-3 | No app telemetry; alerts email nobody | Certain; an outage or a run of 500s is found by a user | Set `alertEmails`; apply `sendAppLogsToLogAnalytics`; then add log alerts |
| R-4 | Failed SQL statements logged their bound values | **Closed during the audit** (commits `4902a0a`, `f305397`): the statement, its values and Postgres's `detail` are withheld at every level of the logged error, with tests | Keep log readers limited all the same: paths carry quote numbers |
| R-5 | Sees-all roles are not narrowed by RLS under a `region` or `account_list` scope | Only if an Admin sets such a scope; then a quote opens by number despite the scope | Refuse non-`all` scopes for those roles, or add the domain check to per-quote reads (`04` N-09) |
| R-6 | Live Salesforce lookups run before the visibility check | Any quote reader; costs API quota, no data returned | Check the snapshot's visibility first |
| R-7 | Source maps are public | Certain; discloses front-end source only | Build without maps for prod, or serve them only to signed-in Admins |
| R-8 | Transactions held across file-store calls | Needs a slow SharePoint or Blob call; pins connections and, for the offer letter, blocks writes to that quote | Move the network call outside the transaction (`04` N-13) |
| R-9 | Geo-redundant backup off; HA off; public database endpoint | A regional outage or a leaked admin password | Decide with IT; geo-redundancy needs a new server |

## 4. Out of scope, and not verified

- Entra Conditional Access, MFA and "assignment required" on the enterprise app: inherited tenant controls, not verified from the repo.
- Device security of users' laptops and phones, and what users do with exported CSVs and downloaded files.
- The Salesforce org's own security, and the Fabric workspace's once it exists.
- Whether App Service appends `address:port` to `X-Forwarded-For`: the code handles both; one production log line settles it.
- Nothing here was tested against the live production site. The route-level permission claims rest on `docs/security/route-inventory.md` and the integration tests behind it.
