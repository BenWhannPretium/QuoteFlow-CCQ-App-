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
| `CCQ.KAM` | `SG-CCQ-KAM` | KAMs/CAMs, all regions (~30) | Create intake from an SF opportunity. View pipeline per data scope. Attach docs. Raise override requests. Record customer outcome (G5). Flag capital-likely, check terms (B-26). Decide G6 Commit & Hand Off on own quotes (B-26). **Cannot** approve or qualify their own opportunity. |
| `CCQ.SalesLeader` | `SG-CCQ-SalesLeader` | Sales leaders (G1 qualifier, candidate per Op Model §6) | G1 decision (pursue / hold / rework / redirect / stop). Approve priority overrides. Verify closure. |
| `CCQ.EngLead` | `SG-CCQ-EngLead` | Upfront engineering lead (Jim Zweifel's team) | Owns the engineering queue: assign or reassign (B-26: also in bulk), accept or return, capacity sign-off (B-26), G2 decision. |
| `CCQ.Engineer` | `SG-CCQ-Engineer` | Assigned product and ops engineers, capacity analyst | Edit Engineering Review fields and capacity evidence on assigned quotes. |
| `CCQ.Pricing` | `SG-CCQ-Pricing` | Pricing team (Gemma Cebolla's org) | Quoting stage: record price approval, costing attestation, capital-readiness status and the optional legacy ERF number (B-26: BPR retired). Submit to Final Review. **Cannot** approve Final Review. |
| `CCQ.PricingLead` | `SG-CCQ-PricingLead` | Pricing lead (B-26, A6) | Everything Pricing can do, plus triage: assign and reassign pricers on the pricing queue (`pricingQueue.assign`). |
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

Fields tagged `sensitivity: 'commercial'` are stripped server-side for any role that isn't Pricing, PricingLead (B-26), EngLead, Approver, Leadership or Admin. They are:
- price approval details
- pricing-app figures
- capital estimates
- capacity and capital evidence numbers
- margin
- B-11: the whole Quoting tab (pricing record and its version history, references, notes, capital readiness). Other roles get only the approval status: "Price approved ✓ on <date> by <name>".
- B-15: every pricing-app record (ERF and SPR history; B-26 removed the BPR lookups) as a whole, including its estimated revenue, volume and net capital. The pricing-app routes need `quote.read.commercialFields` (403 otherwise). Provisional until Gemma Cebolla confirms the labels at M5.

`packages/domain/policy/redact.ts` does the stripping, and every quote-read route has a test for it.

### 3.4 Permission matrix (source of truth: `packages/domain/src/policy/matrix.ts`)

| Permission | KAM | SalesLeader | EngLead | Engineer | Pricing | PricingLead | Approver | Leadership | Admin |
|---|---|---|---|---|---|---|---|---|---|
| quote.create (intake) | ✔ | ✔ | | | | | | | ✔ |
| quote.read (in scope) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| quote.read.commercialFields | | | ✔ | | ✔ | ✔ | ✔ | ✔ | ✔ |
| gate.G1.decide | | ✔ | | | | | | | |
| engQueue.read (B-10: the engineering queue page) | | | ✔ | ✔ | | | | ✔ | ✔ |
| queue.assign / reassign | | | ✔ | | | | | | ✔ |
| engReview.edit (assigned) | | | ✔ | ✔ | | | | | |
| gate.G2.decide | | | ✔ | | | | | | |
| pricingQueue.read (B-11: the pricing queue page) | | | | | ✔ | ✔ | | ✔ | ✔ |
| quoting.edit | | | | | ✔ | ✔ | | | |
| gate.G3.submit | | | | | ✔ | ✔ | | | |
| finalReview.read (B-12: the Final Review queue, Approvals tab) | | | | | | | ✔ | ✔ | ✔ |
| gate.G4.decide | | | | | | | ✔ | | |
| outcome.record | ✔ (own) | ✔ | | | | | | | |
| outcome.assignOwner (B-13: name a closure owner other than the default) | | ✔ | | | | | | | |
| handoff.edit (B-13: the hand-off record; B-26: in Commit & Hand Off) | ✔ (own) | ✔ | | | | | | | ✔ |
| override.request | ✔ | ✔ | ✔ | | ✔ | ✔ | | | |
| override.approve | | ✔ | ✔ (priority, queue) | | | | | | ✔ |
| override.revert | | ✔ | ✔ | | | | | | ✔ |
| overrideLog.read | | | | | | | | ✔ | ✔ |
| audit.read (B-09: audit viewer, usage report) | | | | | | | | ✔ | ✔ |
| attachment.upload | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | | | |
| attachment.removeAny (B-16: remove anyone's file; an uploader may remove their own within 24 h) | | | | | | | | | ✔ |
| export.csv | ✔ (scope) | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ | ✔ |
| analytics.read | | ✔ | ✔ | | ✔ | ✔ | ✔ | ✔ | ✔ |
| config.read (B-19: every Admin configuration screen, read-only) | | | | | | | | ✔ | ✔ |
| config.manage | | | | | | | | | ✔ |
| pricingQueue.assign (B-26: assign / reassign pricers) | | | | | | ✔ | | | ✔ |
| capacity.signoff (B-26: G2 capacity sign-off) | | | ✔ | | | | | | |
| capitalFlag.edit (B-26: capital likely) | ✔ (own) | ✔ | ✔ | ✔ (assigned) | ✔ | ✔ | | | |
| terms.edit (B-26: terms check, Legal review record) | ✔ (own) | ✔ | | | ✔ | ✔ | | | |
| gate.G6.decide (B-26: Commit & Hand Off) | ✔ (own) | ✔ | | | | | | | |
| quote.escalate (B-26: raise an escalation) | ✔ (own) | ✔ | ✔ | ✔ (assigned) | ✔ | ✔ | ✔ | | ✔ |

> The G1 decider (D-06), the override approver (blueprint gap) and the Final Review approver (D-10) are **open decisions**. The matrix is config-backed (`role_permission` table seeded from `matrix.ts`), so changing who approves needs no code change.

---

## 4. Workflow model (configurable stage and gate engine)

### 4.1 Seeded "hybrid" stage model

PRD v1's five stages are reconciled with the Operating Model's six stage-gates. Stage labels are editable in config.

| # | Stage key | Display label (seed) | Owner role | Gate at exit | Gate outcomes (seed) | Notes |
|---|---|---|---|---|---|---|
| 1 | `INTAKE` | Intake | KAM | **G1 Qualify & prioritize** (decider: SalesLeader; config flag `g1_enabled`, default **true**) | Advance · Hold · Rework (to KAM) · Redirect (stock / inquiry / other capital) · Stop | Draft → Submitted. The priority score is computed at submit (advisory). Min value/volume screens raise **warnings**, not blocks, until D-06 is decided. |
| 2 | `ENG_REVIEW` | Engineering Review | EngLead | **G2 Feasible solution?** | Advance · Proceed with risk · Advance – capital required · Hold · Rework (to KAM) · Redirect (B-26) · Stop | Manual prioritized queue (DEC-26). The EngLead is alerted on arrival, assigns, accepts or returns. Captures process, machine, plant/site, cavitation, cycle time, preliminary capital, **capacity evidence** (CR-19). B-10 rules: Proceed / Proceed with risk need the solution fields + ≥ 1 capacity row (risk: + note); Capital required needs the capital figure and sets capital readiness to pending; Hold: reason + review date; Rework: reason + note; Stop: reason + note, closes as **DECLINED**. B-26: Advance and Capital required also need the **capacity sign-off** (`capacity_signoff_status` = approved, EngLead); Redirect needs a note and keeps the quote in Engineering Review for the decider to route; Equipment BOM and Supply Chain notes are captured. |
| 3 | `QUOTING` | Quoting | Pricing | **G3 Price approved & capital ready** (submit to Final Review) | Advance to Final Review · Hold · Re-cost (B-26) · Rework (to Eng) · Redirect (B-26) · Stop | Records price approval (approver, date, basis, range note, pricing-app refs, costing attestation) and capital-readiness status, one record per quote version. No editable price figures. B-11 rules: Submit needs approver + date, an ERF/BPR reference or a "no pricing-app record yet" note, and capital readiness ≠ pending unless a pending-capital justification is given (a warning, D-11); notifies the Approver group. Hold: reason + review date; Rework: reason, bumps the version; Stop: reason + note, closes as **DECLINED**. Segregation: whoever approved the price or decided G3 on the version cannot decide G4. **B-26 rules (supersede the reference rule):** Advance needs the price approval **or** `pass_through_eligible` (below `pricing_pass_through`), the costing attestation, capital readiness, and when the quote is flagged capital-likely, readiness `not_required` or `pre_approved`; no ERF or BPR reference is required (the legacy ERF # is optional). Re-cost needs a note, clears the costing attestation and stays in Quoting. A pricing lead assigns pricers. |
| 4 | `FINAL_REVIEW` | Final Review | Approver | **G4 Release proposition** | Advance (release the offer) · Hold (B-26) · Rework (back to the affected gate) · Stop (withdraw, note required) | **Internal** approval only. It does *not* set Awarded or Lost (fixes PRD F-16, X-88). B-12 rules: Approve sets `proposal_issued_at` (default now, editable, not future) and `validity_until` (+ `validity_days_default`) and tells the KAM; Decline needs note + `decline` reason, closes as **DECLINED**, tells KAM + Pricing; Return needs a note + target, bumps the version. Segregation: not the KAM, not the Pricing approver. Optional approver tiers: `g4_tier_rules` (disabled). B-26: Advance needs the **terms check** (`terms_checked_at`) and, when `legal_review_required` (from `legal_review_triggers`: new customer, non-standard terms, tooling commitment), the Legal review date. |
| 5 | `CUSTOMER_DECISION` | Customer Decision | KAM | **G5 Outcome recorded** (decider: `outcome.record`, the KAM on own quotes or a SalesLeader) | Awarded · In negotiation (B-26) · Lost · No response/Expired · On hold · Re-quote | Proposal issue date and validity date (seed 30 days, provisional, D-12); the header shows a validity countdown (amber at ≤ `validity_warning_days`, red when expired) and the SF stage side by side with a mismatch flag. B-13 rules: Awarded needs the acceptance evidence (reason, context `awarded`: verbal / PO / LOI / contract) + acceptance date, optional document link, opens the hand-off record and (B-26) **moves the quote to Commit & Hand Off; it no longer closes**; In negotiation (B-26) needs a note and keeps the quote here; Lost needs a reason (Other + note), optional competitor; Expired ("silence is not a loss", its own state) needs a reason, and before the validity date also a note; On hold needs a reason + review date (the hold stops the cycle-time clock); Re-quote needs a change reason + target (QUOTING or ENG_REVIEW) and bumps the version. Customer outcomes' closure owner defaults to the KAM. A daily job flags lapsed validity and tells the KAM; nothing auto-closes (D-12). |
| 6 | `COMMIT_HANDOFF` | Commit & Hand Off (B-26) | KAM | **G6 Commit & hand off** (`gate.G6.decide`: KAM own, SalesLeader) | Advance (close Won) · Hold (commitment pending) · Rework (re-quote) · Stop (commitment not authorized) | The hand-off record: acceptance evidence, CER ID + **CER status** (pending / approved / not_approved / not_required) + CER approval date, receiving role and contact, accepted-by date and "Hand-off accepted" (CR-41/42; `handoff.edit`). Advance needs the CER approved or not required and the hand-off accepted, then closes **AWARDED** (closure owner: KAM). Stop needs a `not_authorized` reason + note and closes **NOT_AUTHORIZED** (owner: decider). Rework returns to Quoting or Engineering Review with a new version. |
| T | `AWARDED` | Closed – Won | — | — | — | Terminal (B-26: reached from G6, not G5). The hand-off record stays readable. |
| T | `NOT_AUTHORIZED` | Closed – Commitment not authorized (B-26) | — | — | — | Terminal, internal outcome. |
| T | `CLOSED_LOST` · `DECLINED` · `EXPIRED` · `REDIRECTED` | Closed | — | — | — | Outcome + reason code + closure owner + date are mandatory on **every** terminal path (CR-39/40): `evaluateTransition` plans them (`TransitionEffects.closure`), refuses a closing decision without a reason, and the DB repeats it (`quote_closure_complete_check`). |

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
- Re-quote and return paths go **back to the affected stage only** and bump `quote.version`. Prior approvals are kept, never edited (CR-38); the read model marks decisions taken on an earlier version `superseded` (B-13).
- A closing transition records its closure (B-13, CR-39): outcome = `closeAs`, the reason code (always required to close), the closure owner (`transition_rule.closure_owner`: `kam` for customer outcomes, `decider` for internal no-gos; `outcome.assignOwner` may name another) and `closed_at`.
- On-hold time is tracked separately so cycle time can exclude customer holds (CR-57).

**Holds (B-26):** every Hold outcome needs `holdOwnerId` (an active user; the dialog defaults to the decider), stored on `quote_hold.owner_id` and on `quote.hold_owner_id` while the hold lasts. **Definitions (B-26):** every outcome carries `help_text`, shown as an ⓘ in the decision dialog.

**Gate decision API (built in B-08; reuse it for G2–G6)**

One route and one service record every gate decision. Later stages add no decision route of their own.

| | |
|---|---|
| Route | `POST /api/v1/quotes/:quoteNumber/gates/:gateKey/decisions` with `{ outcomeKey, note?, reasonCode?, holdUntil?, holdOwnerId?, targetStageKey? }` (`apps/api/src/routes/v1/gates.ts`) |
| Service | `GateService.decide` (`apps/api/src/services/gateService.ts`) |
| Who | The route floor is `quote.read`. The domain then checks the gate's own `deciderPermission` from `gate_definition`, the data scope and the segregation rules, so who decides a gate is config. A caller who may not decide gets **403**. |
| Rules | `evaluateTransition` plus the qualification exception note (`exceptionNoteErrors`). Every unmet rule comes back in one **422** problem, `errors[]` with `{ path, message, code }`. `holdUntil` is passed to the domain as `payload.review_date`. |
| One transaction | `gate_decision` (evidence = the domain's rule fields **plus** the priority breakdown, warnings and key intake fields the decider saw), `quote_hold`, `stage_history`, the quote row (`review_date` for holds; `submitted_at` cleared when a Rework re-enters INTAKE), `activity_event`, `audit_event`, then a rescore |
| Notifications | B-18: written **in the decision's transaction** (so a rolled-back decision notifies no one) by `persistNotifications`: the arrival alerts, a quote returned to its KAM, the G4 decisions. After commit, `NotificationHook` only observes what was planned (a test seam); it no longer delivers. See §4.3. |
| Read side | `GET /api/v1/quotes/:quoteNumber` returns `availableActions` (each with `requiresReviewDate`, `requiresExceptionNote` and the `missing` fields). `GET /api/v1/gates/:gateKey/queue` lists the quotes waiting for a gate. The web's `GateDecisionDialog` renders from these, so G2–G5 need no new dialog. |

To add a stage's decisions (B-10 to B-13): seed or adjust the gate, outcome and transition rows. Open the dialog with `gateKey="G2"` (or whichever gate), and add any stage-specific evidence to `GateService` only if the decider needs to see it. If a stage edits a scoring input (e.g. `eng_review.prelim_capital_usd`), call `ScoringService.recalculate`.

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

The mapping table `sf_stage_map` is config, so mismatches can be flagged; for example, CCQ shows Awarded while SF still shows Quoting. B-26: "Verbal Award" and "PO(s) in hand" hint at `COMMIT_HANDOFF`, and SF "Closed Won" agrees with a quote in Commit & Hand Off or Closed – Won.

---

### 4.3 Notifications (B-18)

Every notification is written **in the same transaction as the change** that causes it (`apps/api/src/services/notificationService.ts`). One event becomes an `in_app` row (the bell) and, for the types the catalogue emails (`packages/domain/src/notifications/events.ts`), an `email` row (the outbox). A dispatcher job (`apps/api/src/jobs/notificationDispatch.ts`, every minute, advisory lock) sends the outbox through the `MailTransport`.

| Event (`type`) | Recipients | In-app | Email |
|---|---|---|---|
| Quote entered the engineering queue (`quote.ready_for_eng_review`) | every active `EngLead` + the backup assigners (config) | yes | yes |
| Assigned / reassigned (`quote.assigned`) | the engineer | yes | yes |
| Returned to the KAM, G1/G2 rework (`quote.reworked`) | the KAM | yes | yes |
| Waiting at G1 (`quote.to_qualify`) | holders of the G1 decider permission (`SalesLeader`) | yes | **daily digest, 7:00 AM Central**: one email listing everything waiting |
| Awaiting Final Review (`quote.ready_for_final_review`) | holders of `gate.G4.decide` (`Approver`) | yes | yes |
| G4 decided (`quote.approved_for_customer`, `quote.declined`) | the KAM, the pricing approver (who approved the price at G3), and on a decline the `Pricing` role | yes | yes |
| Assigned to a pricer (`quote.pricing_assigned`, B-26) | the pricer | yes | yes |
| Capital likely flagged (`quote.capital_likely`, B-26) | `capital_management_notice.recipientUserIds` (once per quote) | yes | yes |
| Market Development threshold reached (`quote.market_dev`, B-26) | `market_development_notice.recipientUserIds`, on arrival in Engineering Review (once per quote) | yes | yes |
| Escalation raised (`quote.escalated`, B-26) | the route's roles and users in `escalation_routes`, plus the Process Owner where the route says so | yes | yes |
| Override requested / decided (`override.*`) | the approvers / the requester | yes | no |
| @mention in a comment (`comment.mention`) | the mentioned user | yes | yes (who and where, never the comment) |
| Proposal validity within `validity_warning_days` / passed (`quote.validity_expiring`, `quote.validity_expired`) | the KAM | yes | yes, once per state (dedupe key = quote + validity date) |
| Integration failure (`integration.failed`) | Admins | yes | no |
| Email failed after every retry (`notification.delivery_failed`) | Admins (the owners) only | yes | no |

- **Email rules.** Plain branded HTML plus a text alternative; subject `[QuoteFlow] CCQ-2026-00042 needs your review: Engineering queue`; the body has the quote number, account, product, tier, the action and a deep link. **No pricing, margin or capital figure in any email, whatever the recipient's role:** templates take no commercial field, free text is scrubbed of amounts of money, and the finished message is scanned and refused if one remains (`packages/domain/src/notifications/commercial.ts`). Account, product and tier are read **as the recipient** (their roles and data scope, RLS on), so an email never says more than the recipient may see in the app.
- **Delivery.** 3 tries: the first, then after 1 minute, then after 5 more. The third failure is final (`failed_at`): the owners (Admins) get an in-app alert and an error log; nobody else does. A message the mail system refuses (bad address) is final at once. A recipient who is inactive, has no address or opted out is skipped.
- **Preferences.** `user_preference` (`email.<type>` = false): each user can opt out of email per type at `/me/preferences`; in-app cannot be switched off. The app setting `email_notifications_enabled` (default true) switches all email off: in-app only, the documented fallback.
- **Transport.** `MAIL_MODE` = `graph` (production; Graph `sendMail` as MIME from `MAIL_FROM`, app-only `Mail.Send` limited to that mailbox by an Exchange application access policy), `smtp` (mailpit, `docker compose up -d mailpit`, inbox on :8025) or `fake` (default; nothing leaves the process).
- **The actor (B-26, A7).** An event never notifies the person who caused it, except a role alert (`notifyActorViaRole`, e.g. the engineering-queue and pricing arrivals) when the actor also holds the receiving role: a KAM who is also an EngLead is told their own submission reached the queue.
- **Not in P0:** the Teams digest and SLA / stale alerts (their thresholds are open: D-20).

## 5. Data model (PostgreSQL 16, Drizzle)

All tables have `id uuid v7 pk`, `created_at`, `updated_at`, `created_by`. Config tables also carry `version`, `provisional bool` and `approved_by`/`approved_at`. B-19: the admin console bumps `version` on every change (optimistic concurrency, 409 on a stale version), and a re-seed only refreshes rows still at `version = 1`, provisional and unapproved, so it never overwrites an admin's edit.

**Identity and access**
- `app_user`: entra_oid (unique), upn, display_name, email, region, active, last_seen_at
- `user_role`: user_id, role. Synced from the token on each sign-in; the token is the source of truth.
- `user_scope`: user_id, scope_type, values[], version (B-19: edited in Admin › Users)
- `role_permission`: role, permission. Config, seeded from the matrix.

**Reference and config** (all admin-editable and versioned)
- `value_list`: list_key (product_family | market | resin | component | process_type | machine_type | plant | request_class | drawing_status | neck_finish | packaging_type | tooling_funding_model (B-26)), code, label, sort, active, provisional
- `stage_definition`, `gate_definition`, `gate_outcome_definition`, `transition_rule`. B-19: the first three carry `help_text`; labels, help text, `requires_note` / `requires_reason_code` and required-field rules are admin-editable. Stages and transitions are added or removed only by migration plus a domain seed change.
- `reason_code`: context (rework | redirect | stop | decline | lost | expired | hold | requote | override | awarded | not_authorized (B-26)), code, label, active
- `scoring_model`: version, attributes jsonb (key, label, weight, scale, mapping), tier_thresholds jsonb, effective_from, approved_by, change_reason. B-19: `effective_from` null = the (single) draft, never used to score; activation sets it to now. Versions are never edited once active.
- `app_setting`: key, value jsonb. Examples: validity_days_default, g1_enabled, min_value_warning, min_volume_warning_by_process, sla_hours_by_stage (null until D-20), eng_queue_aging_days (B-10 buckets, not an SLA), eng_queue_backup_assigner_user_ids (R-04), capital_readiness_on_outcome, pricing_ref_formats (B-11; B-26: the legacy ERF format only), g4_tier_rules (B-12, null = disabled), validity_warning_days and handoff_receiving_roles (B-13), attachment_settings (B-16: folder templates, uploader removal window), role_change_request_url (B-19: the IT form for Entra group changes); B-26: pricing_pass_through (D-24), legal_review_triggers (D-25), capital_management_notice and market_development_notice (D-27), process_owner and escalation_routes (D-28). Each key's editor and validator: `packages/domain/src/config-admin/settings.ts`.
- `sf_stage_map`: sf_stage, ccq_stage_hint

**Core workflow**
- `customer`: sf_account_id (nullable), name, status (`existing` | `not_yet_established`), default_ship_to jsonb, source, last_synced_at, location, contact jsonb. A not-yet-established customer has no SF account and carries only name, location and contact; DEC-27.
- `sf_opportunity_snapshot`: sf_opportunity_id (unique), name, account_id, owner_alias/owner_email, amount, close_date, sf_stage, erf_number_sf, quote_source_sf, raw jsonb, synced_at
- `quote`: the CCQ record.
  - **Identity and status:** quote_number (unique, `CCQ-2026-00001`), sf_opportunity_id (fk snapshot, required), customer_id, kam_user_id, stage_key, status (active | on_hold | closed), version
  - **Intake fields:** description, structured_description jsonb, product_family, market, resin, components[], est_annual_volume, est_annual_revenue (+ est_annual_revenue_sf, the SF amount it came from), est_annual_volume_confirmed, expected_close_date, drawing_status, neck_finish, packaging_type, packaging_notes, request_class, comments_for_engineering, submitted_at
  - **Ship-to:** ship_to jsonb plus ship_to_overridden bool, ship_to_original jsonb, ship_to_override_reason (interim until B-09 overrides)
  - **Priority:** priority_score, priority_tier, priority_tier_overridden bool, scoring_model_version
  - **Engineering:** assigned_engineer_id, assigned_at (B-10), queue_position + queue_position_overridden (EngLead pin, B-09)
  - **Pricing (B-26):** assigned_pricer_id, pricer_assigned_at
  - **Commercial (B-26):** capital_likely (+ set_by / set_at), capital_notice_sent_at, market_dev_notice_sent_at, tooling_funding_model; terms_payment_terms, terms_moq, terms_tooling_commitment, terms_nonstandard, terms_notes, terms_checked_at / terms_checked_by; legal_reviewed_on, legal_reviewer_name, legal_review_note, legal_recorded_by; hold_owner_id (while on hold)
  - **Links and dates:** erf_number (B-26: the legacy ERF number, transition only), cer_id (mirrored from the hand-off), bpr_id (B-13; **deprecated in B-26**, no longer written), proposal_issued_at, validity_until, validity_expired_flagged_at (B-13 expiry job)
  - **Close-out:** outcome, outcome_reason_code, closure_owner_id, closed_at
- `quote_draft` (B-07): owner_user_id, sf_opportunity_id, step, data jsonb, submitted_quote_id, submitted_at. Intake work in progress; visible only to its creator, plus Admin. It becomes a quote on submit.
- `stage_history`: quote_id, stage_key, entered_at, exited_at, entered_by, on_hold_ms
- `gate_decision`: quote_id, gate_key, outcome_key, decided_by, decided_at, note, reason_code, evidence jsonb (snapshot), conditions
- `eng_review`: quote_id, accepted_at, accepted_by, returned_reason, process_type, machine_type, plant_code, cavitation, cycle_time_s, tooling_notes, prelim_capital_usd *(commercial)*, downstream_equipment_notes, technical_concept_notes; B-26: equipment_bom_notes, supply_chain_notes, capacity_signoff_status (approved | blocked) + capacity_signoff_by / at / note (cleared with acceptance). Acceptance is cleared each time the quote (re-)enters ENG_REVIEW and on reassignment; the fields are kept.
- `capacity_evidence`: quote_id, site, line_asset, assumed_effectiveness_pct, cycle_time_s, utilization_pct, buffer_pct, analysis_date, analyst_id, notes. **All fields are entered** with no OEE default; D-08.
- `pricing_record` *(commercial)*: quote_id, **quote_version** (unique together: one record per version; a Rework / Return starts a new one and the prior stays as history, CR-38), price_approved_by, price_approved_at, pricing_basis_note, pricing_refs jsonb `{erf: []}` (format-checked against `app_setting.pricing_ref_formats`; B-26: BPR refs and no_pricing_app_record_note are no longer written), approved_range_note, costing_completed + costing_attested_by/at (CR-25 attestation only), capital_readiness (not_required | pending | pre_approved | not_approved), cer_reference, capital_notes, capital_pending_justification. B-11. Never a price figure.
- `override`: quote_id, field (priority_tier | ship_to | queue_position | …), original_value jsonb, requested_value jsonb, justification (required), requested_by, status (requested | approved | rejected | applied | reverted), approval_mode (approver | self), decided_by, decided_at, decision_note, applied_at, reverted_by, reverted_at. At most one open (requested) override per quote and field (partial unique index). Which fields, and who requests / approves / reverts each, is `app_setting.overridable_fields` (B-09). The quote carries `*_overridden` flags (`priority_tier_overridden`, `ship_to_overridden`, `queue_position_overridden`).
- `attachment`: quote_id (null while on an intake draft), draft_id, kind (bottle_drawing | spec | sample_photo | other), file_name (original), stored_name (sanitized), size, mime (canonical for the verified type), note, sha256, storage (sharepoint | blob | local), storage_item_id, storage_path, sp_drive_id, sp_item_id, sp_web_url, uploaded_by, removed_at / removed_by (soft delete). B-16: draft files are visible to the draft's owner and Admin (RLS), quote files with the quote.
- `comment`: quote_id, author_id, body, mentions[]
- `handoff_record`: quote_id, acceptance_evidence (verbal | po | loi | contract), acceptance_date, acceptance_document_url, receiving_role (+ receiving_role_other), receiving_contact_name, accepted_on, accepted_by_name, cer_id, cer_status (pending | approved | not_approved | not_required, B-26), cer_approved_on (B-26), bpr_id (deprecated in B-26), notes, completed_at / completed_by ("Hand-off accepted"), updated_by. Stage 6 (B-13, B-26). Opened by the G5 Awarded decision; G6 Advance needs it.
- `quote_hold`: quote_id, stage_key, started_at, ended_at, reason_code, owner_id (B-26). Hold intervals, so cycle time can exclude holds (CR-57).
- `segregation_rule`: rule_key, gate_keys[], outcome_keys[], deny (actor_is_kam | actor_is_assigned_engineer | actor_is_price_approver), message. Config.
- `quote_number_counter`: year, last_value. Used only by `next_quote_number()`.

The full column list, with each column's meaning and owner, is generated into [`docs/data-dictionary.md`](../data-dictionary.md) (`pnpm db:dictionary`).

**Events and audit**
- `activity_event`: quote_id, type, actor_id, at, payload jsonb. Powers the user-facing timeline.
- `audit_event` (append-only; UPDATE/DELETE revoked from the app role): at, actor_id, actor_roles, action (view | create | update | stage_change | gate_decision | override_* | upload | download | export | config_change | sign_in), entity, entity_id, quote_id, before jsonb, after jsonb, change_reason (B-19: required on config_change; the F-21 decision log reads these rows), ip, user_agent, request_id
- `notification`: user_id, type, quote_id, title, body, read_at, channel (in_app | email), sent_at, error. B-18 adds `dedupe_key` (once per state: unique per user and channel), `payload` (the non-commercial facts an email is built from), and the outbox state `attempts`, `next_attempt_at`, `failed_at`. An `email` row is the outbox entry the dispatcher sends; an `in_app` row is the bell's item.
- `user_preference`: user_id, key, value jsonb; unique (user_id, key). B-18: `email.<notification type>` = false opts out of that email (a missing row = on). Any request context may read them (the actor of an event must know who opted out); only the user or Admin writes.
- `integration_run`: source (salesforce | pricing | sharepoint), started_at, finished_at, status, counts jsonb, error

**Indexes (minimum)**
- quote(stage_key, priority_score desc)
- quote(kam_user_id)
- quote(sf_opportunity_id), plus the unique partial index `quote(sf_opportunity_id) where status <> 'closed'` (one active CCQ quote per SF opportunity, B-07)
- stage_history(quote_id, entered_at)
- audit_event(quote_id, at)
- audit_event(actor_id, at)
- sf_opportunity_snapshot(name gin_trgm)
- B-14 (pipeline views): quote(quote_number gin_trgm), quote(description gin_trgm), customer(name gin_trgm), quote(updated_at desc), stage_history(quote_id, entered_at) where exited_at is null

**Quote number:** a sequence per calendar year, generated in the DB function `next_quote_number()`.

---

## 6. Integrations

| System | Direction | Mechanism (MVP) | Credential / owner | Fallback until access lands |
|---|---|---|---|---|
| **Salesforce** (Unlimited Edition, `pretiumpkg.my.salesforce.com`) | Read-only | `jsforce` with the OAuth 2.0 **JWT bearer** flow, as a dedicated **read-only integration user** on a connected app. SOQL on `Opportunity`, `Account` and the custom `Opportunity Product Specification` object. Delta sync every 15 min (`SystemModstamp`), plus a live lookup on intake search. Start against the **UAT org** (`integration@pretiumpkg.com.uat`), then production. | Private key in Key Vault. **Rachel Dew** (SF admin) creates the connected app, integration user and permission set. **Zac Cairns / Graham Parle** own the field crosswalk. | `FakeSalesforceReader` loaded from a masked fixture JSON. Shaped like the "New Last Week" report (102 rows; fields: name, account, amount, close date, stage, owner alias). |
| **Pricing application** (legacy .NET; ERF, BPR, SPR tables) | Read-only | `PricingReader` interface (B-15: `packages/integrations/src/pricing/`, `PRICING_MODE` = fake \| sqlserver \| fabric; column names only in `columnMap.ts`). Route decided at M5: **(A)** read-only SQL login on a replica/view (`mssql`), or **(B)** the D&A-landed copy in Fabric via its SQL analytics endpoint. Lookup by ERF number, BPR number and customer. SPR read for history only. | **Cory McGahan** (IT: DB access and schema), **Gemma Cebolla** (Pricing: scope and sensitivity), **Brennan Paul** (D&A: Fabric route) | Reference fields typed manually (ERF #, BPR #) and validated by format only. |
| **SharePoint** (ERF/drawing folders) | Read/write files only | Microsoft Graph, **app-only, `Sites.Selected`** scoped to one site. Folder per quote: `/CCQ/{quote_number}/` (`attachment_settings`). Upload via a resumable upload session in 5 MB ranges; the API streams the bytes. B-16: `FileStore` in `packages/integrations/src/graph/`, `FILESTORE_MODE` = sharepoint \| blob \| local. | IT grants Sites.Selected. **Bailey / BT** confirms the folder structure being prepared for Ranger. | Store files in a private Azure Blob container behind the same interface. |
| **Email / Teams** (P0: alert the engineering lead; P1: digest) | Outbound | B-18: `MailTransport` in `packages/integrations/src/mail/` (`MAIL_MODE` = graph \| smtp \| fake). Graph `sendMail` as MIME from the shared mailbox (`MAIL_FROM`, e.g. `ccq-noreply@pretiumpkg.com`), app-only `Mail.Send` restricted to that one mailbox by an Exchange application access policy; credentials as for SharePoint. smtp = mailpit locally. Production allows `graph` only. Teams digest is P1. | IT: mailbox + application access policy (M7) | In-app notifications only (set `email_notifications_enabled` to false). |
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
| ERF | Engineering Request Form, the legacy pricing-app record. **Not "ERS"** (X-33). B-26: kept only as an optional "Legacy ERF #" during the transition. |
| BPR | Price-implementation request. **Retired in CCQ by B-26** (A4): no field, lookup or gate rule. |
| SPR | Stock pricing request. **Historical only**, retired Nov 2025 and replaced by the SF stock workflow. |
| ECE | Engineering cost estimate |
| CER | Capital expenditure request (Apex). Linked by ID only in MVP. |
| PTF | Customer price-quote form. Pricing valid 30 days per the template. |
| NPI / NPD | **Pre-award** upfront engineering (Jim Zweifel's team) unless stated otherwise. Post-award is Nicole Donnelly and Anne DeSmet. |
| OEE | Overall equipment effectiveness. The template defaults to 85%; capacity says ~70%. **No default in CCQ** (D-08). |
| G1–G6 | Gate decisions (see §4.1). G6 Commit & Hand Off was added in B-26. |
| Pass-through | A quote below `pricing_pass_through` that needs no Pricing approval at G3 (B-26, D-24). |
| Process Owner | The named owner of the CCQ process who receives process escalations (B-26, D-02 / D-28). |
