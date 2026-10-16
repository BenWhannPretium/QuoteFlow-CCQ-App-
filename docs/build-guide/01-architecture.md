# 01: Application Architecture

**Status:** v1.0, 2026-10-15, for the Gate 3 design review. **Owner:** Ben Whann (Embedded Intelligence).
**Sources:** PRD v1 (2026-10-12), CCQ Workflow Blueprint, CCQ Future-State Operating Model (2026-10-15), CCQ Discovery & Design Evidence Base v1.0, Requirements Sync recap (2026-10-14).

---

## 1. Architecture at a glance

```
                               ┌──────────────────────────── Pretium Entra ID tenant ───────────────────────────┐
  KAM / Eng / Pricing /        │                                                                                 │
  Approver / Leadership        │   ┌──────────────── Azure App Service (Linux, Node 22) ─────────────────┐      │
  (desktop + phone, no VPN) ───┼──►│  QuoteFlow                                                          │      │
        │  MSAL sign-in        │   │   • React SPA (static, served by the API)                           │      │
        ▼                      │   │   • Fastify API  /api/v1  ── policy check ── domain engine          │      │
   Entra ID (SSO, MFA, CA)     │   │   • Background jobs (SF sync, SLA timers) via pg advisory locks     │      │
   app roles ← security groups │   └──────┬───────────────┬──────────────┬──────────────┬────────────────┘      │
                               │          │ managed id     │ managed id   │ app-only     │ OTel                  │
                               │          ▼                ▼              ▼              ▼                       │
                               │  Azure DB for PostgreSQL  Key Vault    Microsoft Graph  Application Insights   │
                               │  (private endpoint, RLS)  (secrets,    (SharePoint      (logs, traces,         │
                               │                            SF cert)     files, mail)    availability tests)    │
                               └──────────────┬──────────────────────────────┬───────────────────────────────────┘
                                              │ read-only                    │ read-only
                                              ▼                              ▼
                                   Salesforce (Opportunity,       Pricing application DB (ERF / BPR;
                                   Account, Opp Product Spec)      SPR historical) or its Fabric copy
                                   via integration user (JWT)      via read-only SQL login
```

**Principles**

1. Systems of record stay where they are. CCQ owns only the workflow record: stages, gate decisions, overrides, outcomes and audit.
2. CCQ reads Salesforce and the pricing app. It never writes back in MVP.
3. Business logic lives in one pure package (`packages/domain`) and is enforced on the server.
4. Anything not yet decided by the business is **config**, not code.
5. Build for portability (Darren, 10/14). The domain logic has no Azure or Fastify imports, so it can move later.

---

## 2. Repository layout

```
quoteflow-ccq-app-/
├─ CLAUDE.md                     # standing context for Claude Code
├─ apps/
│  ├─ web/                       # React SPA
│  │  ├─ src/routes/             # TanStack Router file routes (dashboard, intake, quotes/$id, queue, board, approvals, admin)
│  │  ├─ src/features/           # feature folders: intake, quote-detail, eng-review, quoting, final-review, outcome, board, dashboards, admin
│  │  ├─ src/components/ui/      # shadcn/ui primitives themed with Pretium tokens
│  │  ├─ src/auth/               # MSAL config, useCurrentUser, <RequirePermission>
│  │  └─ src/lib/api.ts          # typed fetch client generated from contracts
│  └─ api/
│     ├─ src/server.ts           # Fastify bootstrap, serves SPA in prod
│     ├─ src/plugins/            # auth (jose), request context, audit, problem+json, rate-limit, helmet
│     ├─ src/routes/v1/          # quotes, intake, queue, gates, overrides, attachments, lookups, dashboards, admin, me
│     ├─ src/services/           # orchestration: call domain + repositories + integrations in one transaction
│     ├─ src/jobs/               # sfSync, slaTimers, notificationDispatch
│     └─ test/                   # route + permission-matrix tests (fastify.inject + real Postgres)
├─ packages/
│  ├─ domain/                    # NO I/O. stage engine, scoring, overrides, policy, validation, quote-number
│  ├─ contracts/                 # zod schemas + DTO types shared web/api
│  ├─ db/                        # drizzle schema, migrations, RLS SQL, seeds (config + synthetic data)
│  └─ integrations/              # salesforce/, pricing/, graph/ — each: interface + real impl + fake impl
├─ infra/                        # Bicep: main.bicep + modules (appservice, postgres, keyvault, appinsights, network)
├─ .github/workflows/            # ci.yml (PR), deploy.yml (main → test; manual → prod)
├─ docker-compose.yml            # local Postgres 16 (+ optional mailpit)
└─ docs/build-guide/             # this guide
```

---

## 3. Roles, data scope and permissions

### 3.1 Roles (Entra app roles → security groups, created by IT)

| App role (token `roles` claim) | Entra security group (proposed) | Who (PRD §4 + Op Model) | Core abilities |
|---|---|---|---|
| `CCQ.KAM` | `SG-CCQ-KAM` | KAMs/CAMs, all regions (~30) | Create intake from an SF opportunity. View pipeline per data scope. Attach docs. Raise override requests. Record customer outcome. **Cannot** approve, qualify their own opportunity, or promote to Awarded. |
| `CCQ.SalesLeader` | `SG-CCQ-SalesLeader` | Sales leaders (G1 qualifier, candidate per Op Model §6) | G1 decision (pursue / hold / rework / redirect / stop). Approve priority overrides. Verify closure. |
| `CCQ.EngLead` | `SG-CCQ-EngLead` | Upfront engineering lead (Jim Zweifel's team) | Owns the engineering queue: assign or reassign, accept or return, G2 decision. |
| `CCQ.Engineer` | `SG-CCQ-Engineer` | Assigned product and ops engineers, capacity analyst | Edit Engineering Review fields and capacity evidence on assigned quotes. |
| `CCQ.Pricing` | `SG-CCQ-Pricing` | Pricing team (Gemma Cebolla's org) | Quoting stage: record price approval, capital-readiness status and ERF/BPR references. Submit to Final Review. **Cannot** approve Final Review. |
| `CCQ.Approver` | `SG-CCQ-Approver` | Final Review approver(s), still to be named (D-10) | G4 approve or decline (note required). |
| `CCQ.Leadership` | `SG-CCQ-Leadership` | Sarah Brennan, ELT, commercial leadership | Read everything, including analytics and the override log. **Cannot** change figures. |
| `CCQ.Admin` | `SG-CCQ-Admin` | Knowledge Steward + EI build team (Ben, Tre) | Manage config (value lists, weights, reason codes, stage labels, thresholds) and user data scopes. Every change is versioned. |
| *(P2)* `CCQ.PostAward` | `SG-CCQ-PostAward` | Nicole Donnelly, Anne DeSmet | Read Awarded quotes and the hand-off view. |

A user can hold more than one role, and the effective permissions are the union of those roles.

### 3.2 Data scope

Data scope is stored in `user_scope`: `{ scope_type: all | region | owner | account_list, values[] }`.

- **Default** (PRD lean, open question D-K1): KAMs see the **full pipeline**, including peers' priority scores. Only Leadership and Admin see the override log.
- Scope is enforced twice:
  1. by the policy function in `packages/domain/policy`
  2. by Postgres RLS, using `current_setting('app.user_id')` and `app.roles`, which the API sets per transaction

### 3.3 Field sensitivity

Fields tagged `sensitivity: 'commercial'` are stripped server-side for any role that isn't Pricing, EngLead, Approver, Leadership or Admin. They are:
- price approval details
- pricing-app figures
- capital estimates
- capacity and capital evidence numbers
- margin

`packages/domain/policy/redact.ts` does the stripping, and every quote-read route has a test for it.

### 3.4 Permission matrix (source of truth: `packages/domain/src/policy/matrix.ts`)

| Permission | KAM | SalesLeader | EngLead | Engineer | Pricing | Approver | Leadership | Admin |
|---|---|---|---|---|---|---|---|---|
| quote.create (intake) | ✔ | ✔ | | | | | | ✔ |
| quote.read (in scope) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| quote.read.commercialFields | | | ✔ | | ✔ | ✔ | ✔ | ✔ |
| gate.G1.decide | | ✔ | | | | | | |
| queue.assign / reassign | | | ✔ | | | | | ✔ |
| engReview.edit (assigned) | | | ✔ | ✔ | | | | |
| gate.G2.decide | | | ✔ | | | | | |
| quoting.edit | | | | | ✔ | | | |
| gate.G3.submit | | | | | ✔ | | | |
| gate.G4.decide | | | | | | ✔ | | |
| outcome.record | ✔ (own) | ✔ | | | | | | |
| override.request | ✔ | ✔ | ✔ | | ✔ | | | |
| override.approve | | ✔ | ✔ (priority, queue) | | | | | ✔ |
| override.revert | | ✔ | ✔ | | | | | ✔ |
| overrideLog.read | | | | | | | ✔ | ✔ |
| attachment.upload | ✔ | ✔ | ✔ | ✔ | ✔ | | | |
| export.csv | ✔ (scope) | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ |
| analytics.read | | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ |
| config.manage | | | | | | | | ✔ |

> The G1 decider (D-06), the override approver (blueprint gap) and the Final Review approver (D-10) are **open decisions**. The matrix is config-backed (`role_permission` table seeded from `matrix.ts`), so changing who approves needs no code change.

---

## 4. Workflow model (configurable stage and gate engine)

### 4.1 Seeded "hybrid" stage model

PRD v1's five stages are reconciled with the Operating Model's six stage-gates. Stage labels are editable in config.

| # | Stage key | Display label (seed) | Owner role | Gate at exit | Gate outcomes (seed) | Notes |
|---|---|---|---|---|---|---|
| 1 | `INTAKE` | Intake | KAM | **G1 Qualify & prioritize** (decider: SalesLeader; config flag `g1_enabled`, default **true**) | Advance · Hold · Rework (to KAM) · Redirect (stock / inquiry / other capital) · Stop | Draft → Submitted. The priority score is computed at submit (advisory). Min value/volume screens raise **warnings**, not blocks, until D-06 is decided. |
| 2 | `ENG_REVIEW` | Engineering Review | EngLead | **G2 Feasible solution?** | Proceed · Proceed with risk · Capital required · Hold · Rework (to KAM) · Stop | Manual prioritized queue (DEC-26). Accept or return. Captures process, machine, plant/site, cavitation, cycle time, preliminary capital, **capacity evidence** (CR-19). |
| 3 | `QUOTING` | Quoting | Pricing | **G3 Price approved & capital ready** (submit to Final Review) | Submit · Hold · Rework (to Eng) · Stop | Records price approval (approver, date, pricing-app refs) and capital-readiness status. No editable price figures. |
| 4 | `FINAL_REVIEW` | Final Review | Approver | **G4 Release proposition** | Approve · Decline (note required) · Return (to affected stage) | **Internal** approval only. It does *not* set Awarded or Lost (fixes PRD F-16, X-88). |
| 5 | `CUSTOMER_DECISION` | Customer Decision | KAM | **G5 Outcome recorded** | Awarded · Lost · No response/Expired · On hold · Re-quote | Proposal issue date and validity date (seed 30 days, provisional, D-12). |
| T | `AWARDED` | Awarded | — | (minimal hand-off record) | — | Captures acceptance evidence, CER ID, BPR ID and receiving role (CR-41/42, minimal). |
| T | `CLOSED_LOST` · `DECLINED` · `EXPIRED` · `REDIRECTED` | Closed | — | — | — | Reason code + closure owner + date are mandatory (CR-39). |

**Engine rules (all in `packages/domain/src/workflow`)**

- `stage_definition`, `gate_definition`, `gate_outcome_definition` and `transition_rule` are DB config, seeded from `seeds/workflow.hybrid.ts`.
- A transition is allowed only when **all** of these hold:
  1. the current stage matches
  2. the actor holds the gate's decider permission
  3. the gate's required fields are present (rules in `required_fields` jsonb, evaluated by the domain)
  4. the outcome's `requires_note` / `requires_reason_code` constraints are met
- Every transition writes, in **one transaction**:
  - a `gate_decision` (decision, decider, timestamp, evidence snapshot, conditions, note)
  - a `stage_history` row (enter/exit timestamps used for time-in-stage)
  - an `activity_event`
  - an `audit_event`
- Re-quote and return paths go **back to the affected stage only** and bump `quote.version`. Prior approvals are kept, never edited (CR-38).
- On-hold time is tracked separately so cycle time can exclude customer holds (CR-57).

### 4.2 Salesforce stage mapping (read-only, for reporting)

CCQ owns operational stages. Salesforce stages are read and shown side by side:
- Qualifying
- Quoting
- Negotiating
- Final Review
- Verbal Award
- PO(s) in hand
- Closed Won – Product Shipping
- Closed Lost

The mapping table `sf_stage_map` is config, so mismatches can be flagged; for example, CCQ shows Awarded while SF still shows Quoting.

---

## 5. Data model (PostgreSQL 16, Drizzle)

All tables have `id uuid v7 pk`, `created_at`, `updated_at`, `created_by`. Config tables also carry `version`, `provisional bool` and `approved_by`/`approved_at`.

**Identity and access**
- `app_user`: entra_oid (unique), upn, display_name, email, region, active, last_seen_at
- `user_role`: user_id, role. Synced from the token on each sign-in; the token is the source of truth.
- `user_scope`: user_id, scope_type, values[]
- `role_permission`: role, permission. Config, seeded from the matrix.

**Reference and config** (all admin-editable and versioned)
- `value_list`: list_key (product_family | market | resin | component | process_type | machine_type | plant | request_class | drawing_status | neck_finish | packaging_type), code, label, sort, active, provisional
- `stage_definition`, `gate_definition`, `gate_outcome_definition`, `transition_rule`
- `reason_code`: context (rework | redirect | stop | decline | lost | expired | hold | requote | override), code, label, active
- `scoring_model`: version, attributes jsonb (key, label, weight, scale, mapping), tier_thresholds jsonb, effective_from, approved_by, change_reason
- `app_setting`: key, value jsonb. Examples: validity_days_default, g1_enabled, min_value_warning, min_volume_warning_by_process, sla_hours_by_stage (null until D-20).
- `sf_stage_map`: sf_stage, ccq_stage_hint

**Core workflow**
- `customer`: sf_account_id (nullable), name, status (`existing` | `not_yet_established`), default_ship_to jsonb, source, last_synced_at, location, contact jsonb. A not-yet-established customer has no SF account and carries only name, location and contact; DEC-27.
- `sf_opportunity_snapshot`: sf_opportunity_id (unique), name, account_id, owner_alias/owner_email, amount, close_date, sf_stage, erf_number_sf, quote_source_sf, raw jsonb, synced_at
- `quote`: the CCQ record.
  - **Identity and status:** quote_number (unique, `CCQ-2026-00001`), sf_opportunity_id (fk snapshot, required), customer_id, kam_user_id, stage_key, status (active | on_hold | closed), version
  - **Intake fields:** description, structured_description jsonb, product_family, market, resin, components[], est_annual_volume, est_annual_revenue (+ est_annual_revenue_sf, the SF amount it came from), est_annual_volume_confirmed, expected_close_date, drawing_status, neck_finish, packaging_type, packaging_notes, request_class, comments_for_engineering, submitted_at
  - **Ship-to:** ship_to jsonb plus ship_to_overridden bool, ship_to_original jsonb, ship_to_override_reason (interim until B-09 overrides)
  - **Priority:** priority_score, priority_tier, priority_tier_overridden bool, scoring_model_version
  - **Engineering:** assigned_engineer_id
  - **Links and dates:** erf_number (link), cer_id, bpr_id, proposal_issued_at, validity_until
  - **Close-out:** outcome, outcome_reason_code, closure_owner_id, closed_at
- `quote_draft` (B-07): owner_user_id, sf_opportunity_id, step, data jsonb, submitted_quote_id, submitted_at. Intake work in progress; visible only to its creator, plus Admin. It becomes a quote on submit.
- `stage_history`: quote_id, stage_key, entered_at, exited_at, entered_by, on_hold_ms
- `gate_decision`: quote_id, gate_key, outcome_key, decided_by, decided_at, note, reason_code, evidence jsonb (snapshot), conditions
- `eng_review`: quote_id, accepted_at, returned_reason, process_type, machine_type, plant_code, cavitation, cycle_time_s, tooling_notes, prelim_capital_usd *(commercial)*, downstream_equipment_notes
- `capacity_evidence`: quote_id, site, line_asset, assumed_effectiveness_pct, cycle_time_s, utilization_pct, buffer_pct, analysis_date, analyst_id, notes. **All fields are entered** with no OEE default; D-08.
- `pricing_record` *(commercial)*: quote_id, price_approved_by, price_approved_at, pricing_refs jsonb (ERF/BPR ids from the pricing app), approved_range_note, capital_readiness (not_required | pending | pre_approved | not_approved), capital_notes
- `override`: quote_id, field (priority_tier | ship_to | queue_position | …), original_value jsonb, requested_value jsonb, justification (required), requested_by, status (requested | approved | rejected | applied | reverted), decided_by, decided_at, reverted_by, reverted_at
- `attachment`: quote_id, kind (bottle_drawing | spec | sample_photo | other), file_name, size, mime, sp_drive_id, sp_item_id, sp_web_url, uploaded_by
- `comment`: quote_id, author_id, body, mentions[]
- `handoff_record`: quote_id, acceptance_evidence (verbal | po | loi | contract), receiving_role, accepted_by_name, cer_id, bpr_id, notes. Minimal, for Stage 6.
- `quote_hold`: quote_id, stage_key, started_at, ended_at, reason_code. Hold intervals, so cycle time can exclude holds (CR-57).
- `segregation_rule`: rule_key, gate_keys[], outcome_keys[], deny (actor_is_kam | actor_is_assigned_engineer), message. Config.
- `quote_number_counter`: year, last_value. Used only by `next_quote_number()`.

The full column list, with each column's meaning and owner, is generated into [`docs/data-dictionary.md`](../data-dictionary.md) (`pnpm db:dictionary`).

**Events and audit**
- `activity_event`: quote_id, type, actor_id, at, payload jsonb. Powers the user-facing timeline.
- `audit_event` (append-only; UPDATE/DELETE revoked from the app role): at, actor_id, actor_roles, action (view | create | update | stage_change | gate_decision | override_* | upload | download | export | config_change | sign_in), entity, entity_id, quote_id, before jsonb, after jsonb, ip, user_agent, request_id
- `notification`: user_id, type, quote_id, title, body, read_at, channel (in_app | email), sent_at, error
- `integration_run`: source (salesforce | pricing | sharepoint), started_at, finished_at, status, counts jsonb, error

**Indexes (minimum)**
- quote(stage_key, priority_score desc)
- quote(kam_user_id)
- quote(sf_opportunity_id), plus the unique partial index `quote(sf_opportunity_id) where status <> 'closed'` (one active CCQ quote per SF opportunity, B-07)
- stage_history(quote_id, entered_at)
- audit_event(quote_id, at)
- audit_event(actor_id, at)
- sf_opportunity_snapshot(name gin_trgm)

**Quote number:** a sequence per calendar year, generated in the DB function `next_quote_number()`.

---

## 6. Integrations

| System | Direction | Mechanism (MVP) | Credential / owner | Fallback until access lands |
|---|---|---|---|---|
| **Salesforce** (Unlimited Edition, `pretiumpkg.my.salesforce.com`) | Read-only | `jsforce` with the OAuth 2.0 **JWT bearer** flow, as a dedicated **read-only integration user** on a connected app. SOQL on `Opportunity`, `Account` and the custom `Opportunity Product Specification` object. Delta sync every 15 min (`SystemModstamp`), plus a live lookup on intake search. Start against the **UAT org** (`integration@pretiumpkg.com.uat`), then production. | Private key in Key Vault. **Rachel Dew** (SF admin) creates the connected app, integration user and permission set. **Zac Cairns / Graham Parle** own the field crosswalk. | `FakeSalesforceReader` loaded from a masked fixture JSON. Shaped like the "New Last Week" report (102 rows; fields: name, account, amount, close date, stage, owner alias). |
| **Pricing application** (legacy .NET; ERF, BPR, SPR tables) | Read-only | `PricingReader` interface. Route decided at M5: **(A)** read-only SQL login on a replica/view (`mssql`), or **(B)** the D&A-landed copy in Fabric via its SQL analytics endpoint. Lookup by ERF number, BPR number and customer. SPR read for history only. | **Cory McGahan** (IT: DB access and schema), **Gemma Cebolla** (Pricing: scope and sensitivity), **Brennan Paul** (D&A: Fabric route) | Reference fields typed manually (ERF #, BPR #) and validated by format only. |
| **SharePoint** (ERF/drawing folders) | Read/write files only | Microsoft Graph, **app-only, `Sites.Selected`** scoped to one site. Folder per quote: `/CCQ/{quote_number}/`. Upload via a resumable upload session; the API streams the bytes. | IT grants Sites.Selected. **Bailey / BT** confirms the folder structure being prepared for Ranger. | Store files in a private Azure Blob container behind the same interface. |
| **Email / Teams** (P0: alert the engineering lead; P1: digest) | Outbound | Graph `sendMail` from a shared mailbox (e.g. `ccq-noreply@`) using an application access policy. Teams digest is P1. | IT: mailbox + application access policy | In-app notifications only. |
| **Entra ID** | Auth | SPA app registration (MSAL, auth code + PKCE) and API app registration (exposes the `access_as_user` scope and app roles). API validates JWTs with `jose`. Graph via the App Service managed identity or a client secret in Key Vault. | IT identity team | `AUTH_MODE=dev` locally only |
| **Fabric** (D&A) | Out (later) | **Not MVP.** Post-MVP, mirror the CCQ Postgres to Fabric for D&A-certified analytics. MVP dashboards are labelled "operational; not D&A-certified". | Brennan Paul | — |
| **Ranger AI** | — | P1. Advisory only, via an API when its contract and PoC conclude. | Bailey / Zac | — |

Every integration call writes an `integration_run` row, and failures alert the owners only (PRD).

---

## 7. Security and compliance

**Identity**
- Entra SSO only, with MFA and Conditional Access inherited.
- Tokens are validated on every request: issuer, audience, signature and expiry.
- Roles come from the `roles` claim. Groups are mapped to app roles by IT.

**Exposure** (open item for IT, see D-H2)
- The PRD says "internal only, no public domain" **and** "phone access without VPN". These conflict.
- Recommended pattern: an App Service **private endpoint**, published through **Microsoft Entra Application Proxy / Private Access**, which gives pre-authenticated access from phones without VPN.
- Interim for the test environment: App Service built-in authentication (Entra, require sign-in) plus Conditional Access, with access restrictions to Pretium IP ranges where possible.

**Secrets**
- Key Vault only, read via managed identity.
- Nothing in app settings except Key Vault references.
- GitHub Actions deploys via OIDC federated credentials.

**Database**
- Postgres private endpoint, Entra authentication for the app's managed identity, TLS required.
- RLS policies on `quote` and child tables.
- `audit_event` is insert-only for the app role.

**App hardening**
- helmet with a strict CSP, rate limiting, input validation (zod) on every route, and output redaction for commercial fields.
- No PII beyond business contact data.
- File uploads are size- and type-limited and scanned by SharePoint/Defender.

**Logging**
- pino → App Insights.
- No tokens, prices or customer data in logs; a redaction list applies.

**Data**
- Synthetic or masked data until IT and D&A approve production access. The 205 live SF records already loaded into Bailey's prototype are a governance issue to close (D-23).
- Production data loads only into Azure, never onto laptops.

---

## 8. Environments and delivery

| Env | Where | Data | Deploys |
|---|---|---|---|
| local | Laptop: docker Postgres, `AUTH_MODE=dev` | Synthetic | — |
| test | Azure RG `rg-ccq-test` (App Service B2/P0v3, Postgres Burstable B1ms, KV, AI) | Masked SF fixture, then SF **UAT org** | Auto on merge to `main` |
| prod | Azure RG `rg-ccq-prod` (App Service P1v3 + staging slot, Postgres General Purpose D2ds_v5 with HA off for MVP, PITR 7–35 days) | Approved production SF + pricing | Manual approval in GitHub Actions; slot swap |

**CI** (every PR):
- install
- lint (eslint, prettier)
- typecheck
- unit tests
- integration tests (Postgres service container)
- Playwright smoke against a preview build
- `pnpm audit`
- secret scan (gitleaks)

**IaC:** Bicep modules, parameterized per environment. IT reviews them, and IT or Ben deploys with the permissions IT grants.

**Repository:** GitHub, currently `BenWhannPretium/QuoteFlow-CCQ-App-`. Tre wants it in a **Pretium GitHub organization** for future developers, so transfer it before the first IT review.

---

## 9. Non-functional requirements

| Area | Target (MVP) |
|---|---|
| Users | ~30 KAMs plus ~30 others; < 50 concurrent |
| Volume | ~400–600 quotes/year (FY26 YTD 409 ERFs) |
| Performance | p95 API < 400 ms; board render < 1.5 s on 500 open quotes |
| Availability | Business hours, best effort (single region). App Insights availability test plus an owner alert |
| Mobile | All read views and approve/decline/outcome actions usable at 390 px width (F-14) |
| Accessibility | WCAG 2.1 AA for core flows (keyboard, contrast, labels) |
| Audit retention | ≥ 7 years for `audit_event` (confirm with IT / Legal) |
| Backup | Postgres PITR enabled; quarterly restore test (IT runbook) |

---

## 10. PRD traceability (P0 → build step)

| PRD feature | Build step(s) |
|---|---|
| F-01 SSO | B-04 |
| F-02 Role landing page | B-05, B-17 |
| F-03 Guided intake | B-07 |
| F-04 Stages | B-02, B-03, B-10–B-13 |
| F-05 Prioritization engine | B-08 |
| F-06 Governed overrides | B-09 |
| F-07 Board / list / approvals / prioritization views | B-14 |
| F-08 Activity timeline | B-09 |
| F-09 Role + data scope | B-04, B-21 |
| F-10 Salesforce read | B-06 |
| F-11 Pricing read | B-15 |
| F-12 Usage audit log | B-09 |
| F-13 Attachments | B-16 |
| F-14 Mobile | B-05, B-21 |
| F-15 Notifications (P1, but the P0 eng-lead alert per X-91) | B-18 |
| F-16 Final Review (P1, delivered as a P0 decision record) | B-12 |
| F-17 Analytics (P1, basic in MVP) | B-17 |

| Op Model MUST (MVP) | Build step |
|---|---|
| CR-10 G1 record | B-08 |
| CR-14/15 queue + aging | B-10 |
| CR-19 capacity evidence | B-10 |
| CR-26 price approval record | B-11 |
| CR-29 G4 separate from outcome | B-12 |
| CR-37 validity date | B-13 |
| CR-39 outcome + reason | B-13 |
| CR-51 configurable rules | B-03, B-19 |
| CR-55 time-in-stage | B-10, B-17 |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| CCQ | Commercial Capital Quoting |
| KAM/CAM | Key or Commercial Account Manager |
| ERF | Engineering Request Form, the legacy pricing-app record. **Not "ERS"** (X-33). |
| BPR | Price-implementation request. It always follows an approved quote. |
| SPR | Stock pricing request. **Historical only**, retired Nov 2025 and replaced by the SF stock workflow. |
| ECE | Engineering cost estimate |
| CER | Capital expenditure request (Apex). Linked by ID only in MVP. |
| PTF | Customer price-quote form. Pricing valid 30 days per the template. |
| NPI / NPD | **Pre-award** upfront engineering (Jim Zweifel's team) unless stated otherwise. Post-award is Nicole Donnelly and Anne DeSmet. |
| OEE | Overall equipment effectiveness. The template defaults to 85%; capacity says ~70%. **No default in CCQ** (D-08). |
| G1–G5 | Gate decisions (see §4.1) |
