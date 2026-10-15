# 03: Ordered Build Steps

Each step lists:
- **why** it's at this point in the order
- **who** you need, and the meeting that unblocks it (see `02-schedule-and-meetings.md`)
- **target date**
- **acceptance criteria** (tick them when done)
- the **starter prompt** to paste into Claude Code, found in `prompts/`

**How to run a step in Claude Code**

1. Start a fresh session in the repo root. Claude Code reads `CLAUDE.md` automatically.
2. Paste the contents of `docs/build-guide/prompts/B-xx-*.md`.
3. Let it plan first. Review the plan, then let it build.
4. Before merging, run `pnpm verify` (lint + typecheck + tests), open a PR, and let CI pass.
5. Tick the checklist below and note any deviations.

**Order logic**

```
Foundations           Intake & record         Stages                     Integrations & insight     Ship
B-00 → B-01 → B-02 → B-03 → B-04 → B-05 → B-06 → B-07 → B-08 → B-09 → B-10 → B-11 → B-12 → B-13 → B-14 → B-15 → B-16 → B-17 → B-18 → B-19 → B-21 → B-22 → B-23 → B-24
                                   └─ B-20 (Azure IaC + CD) runs in parallel from Oct 21, first deploy Oct 23
```

- **Domain and data first.** The stage engine, permissions and audit are the spine. Every screen after that is a thin view on top.
- **Integrations get a fake on day 1** (B-06, B-15, B-16), so access delays never block UI work. The real implementation is swapped in once access lands.

---

## Phase 0: Foundations (Oct 15–21)

### B-00: Repo, standing context, tickets · **Thu Oct 15** · Ben
- **Why first:** every later prompt depends on `CLAUDE.md` and this guide being in the repo.
- **People:** Tre (GitHub org), Raj Sharma / IT help desk (tickets in `02` §4).
- **Done when:**
  - [ ] `CLAUDE.md` and `docs/build-guide/` committed on a branch
  - [ ] IT tickets 1–7 filed
  - [ ] M1–M5 invites sent
  - [ ] repo transfer to the Pretium GitHub org requested
- **Prompt:** none (done by this guide).

### B-01: Monorepo scaffold, tooling, CI · **Fri Oct 16** · Ben
- **Why:** a working skeleton with CI keeps quality up while building fast.
- **People:** none (local). Docker Desktop and terminal access are needed (ticket 4).
- **Done when:**
  - [x] `pnpm dev` runs web + api
  - [x] `docker compose up db` works
  - [x] `pnpm verify` is green
  - [x] GitHub Actions CI is green on a PR ([#2](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/2))
  - [x] `/api/v1/health` returns version + DB status
- **Prompt:** `prompts/B-01-monorepo-scaffold.md`
- **Done 2026-10-15. Notes and deviations:**
  - Versions: TypeScript 5.9 (typescript-eslint doesn't support TS 7 yet), ESLint 9, Vite 7, Vitest 4, Tailwind v4, React 18.3, Fastify 5.12, zod 4, Playwright 1.56.
  - `docker compose up -d db` was confirmed on 2026-10-15: the container reports healthy, and `db:migrate`, the integration tests and `pnpm dev` health (`db: up`) all pass against it. The first local checks ran on a native Postgres 16 while Docker Hub was rate-limited. The `mailpit` service wasn't pulled yet (still rate-limited); B-18 is its first user.
  - Workspace packages export TypeScript source (`exports: ./src/index.ts`). The API build (tsup) bundles them, and each package's `build` runs `tsc` only to prove it compiles.
  - Health returns **503** with `status: degraded, db: down` when Postgres is unreachable, so App Service health checks fail over correctly.
  - gitleaks runs as the CLI rather than `gitleaks-action`, so no license key is needed after the move to the Pretium GitHub org.
  - Swagger UI is at `/docs` outside production only.

### B-02: Domain core: stage/gate engine, policy, quote numbers · **Fri Oct 16 – Mon Oct 19** · Ben
- **Why:** this is where the business rules live. Building it pure and tested first makes every later route a thin wrapper.
- **People:** none. The hybrid seed comes from `01-architecture.md` §4.
- **Done when:**
  - [x] `packages/domain` has the workflow engine (transition validation, gate outcomes, required-field rules, return/requote paths, hold accounting)
  - [x] the permission policy and redaction are in place
  - [x] the scoring engine interface exists (implemented in B-08)
  - [x] ≥ 95% line coverage (100% lines)
  - [x] no I/O imports (ESLint `no-restricted-imports`, plus a ban on reading the clock)
  - **Deviations / notes:** added the dev dependency `@vitest/coverage-v8` (needed for `--coverage`) alongside `zod`. `WorkflowConfig` also carries `reasonCodes[]` and `segregation[]`, and requests take an optional `targetStageKey` for return/re-quote. The hybrid seed adds a `SUBMIT` gate for the `g1_enabled=false` path. See `packages/domain/README.md` for the seed assumptions (Stop → CLOSED_LOST, G2 capital-required routing, how a hold resumes), all provisional.
- **Prompt:** `prompts/B-02-domain-core.md`

### B-03: Database schema, RLS, config seeds, synthetic data · **Mon Oct 19** · Ben
- **Why:** persists the domain. Config seeds make open business decisions editable data instead of code.
- **People:** none to start. Value lists are refined after M4 (Jim, Danielle).
- **Done when:**
  - [ ] all tables in `01-architecture.md` §5 exist as migrations
  - [ ] RLS policies are in place, with `audit_event` insert-only for the app role
  - [ ] seeds exist for the hybrid workflow, reason codes, value lists (from the ERF template: 8 processes, 11 resins, 8 markets, ~29 plants) and scoring model v1, all `provisional`
  - [ ] the synthetic generator creates 150 quotes across all stages from 102 masked fake opportunities
- **Prompt:** `prompts/B-03-database-and-seeds.md`

### B-04: Authentication and server-side RBAC (F-01, F-09) · **Tue Oct 20** · Ben
- **Why:** everything after this assumes a known user, roles and scope.
- **People:** **M2 (Mon Oct 19)**, Vincent Brown / IT identity. They provide the app registrations, app roles and groups. Until then, `AUTH_MODE=dev`.
- **Done when:**
  - [ ] MSAL sign-in works against Entra (test tenant config)
  - [ ] the API validates JWTs, maps `roles` to permissions, and upserts `app_user` on first call
  - [ ] the request context sets the Postgres `app.user_id` / `app.roles` per transaction
  - [ ] the permission-matrix test harness exists
  - [ ] dev mode can't start in production
- **Prompt:** `prompts/B-04-auth-rbac.md`

### B-05: App shell, Pretium design system, role landing (F-02 shell, F-14) · **Wed Oct 21** · Ben
- **Why:** a consistent shell and components make every feature screen fast to build.
- **People:** none. Pretium tokens come from the blueprint and the `pretium-design` skill. Bailey's prototype screenshots are a follow-up she owes from 10/14.
- **Done when:**
  - [ ] responsive layout (390 px → desktop)
  - [ ] role-aware navigation
  - [ ] landing route per role (placeholders filled in by B-17)
  - [ ] theme tokens, dark mode, toast/error boundary
  - [ ] `<RequirePermission>` component
  - [ ] Playwright smoke test passes
- **Prompt:** `prompts/B-05-shell-design-system.md`

### B-20: Azure infrastructure as code and continuous delivery · **Wed Oct 21 (code) → Fri Oct 23 (first deploy)** · Ben + IT
- **Why:** an early deploy surfaces network, identity and policy problems while there's still time to fix them.
- **People:**
  - **M1 (Oct 16)** for approval
  - **M2 (Oct 19)** for the resource group, OIDC and the review
  - Tim Webb / Chris O'Brien (IT infra) to run or approve the deployment
- **Done when:**
  - [ ] Bicep for App Service (+ staging slot in prod), PostgreSQL Flexible (private endpoint, Entra auth), Key Vault, App Insights, VNet, managed identity
  - [ ] `deploy.yml` deploys `main` to test via OIDC
  - [ ] the DB migrates on deploy
  - [ ] smoke test passes against the test URL
- **Prompt:** `prompts/B-20-azure-iac-cd.md`

---

## Phase 1: Intake and the core record (Oct 22–27)

### B-06: Salesforce read connector (F-10) · **Thu Oct 22** · Ben
- **Why:** every quote starts from a Salesforce opportunity (DEC-12). Intake can't be built without the opportunity picker.
- **People:** **M3 (Mon Oct 19)**:
  - Rachel Dew: connected app and integration user on the UAT org
  - Zac Cairns + Graham Parle: field crosswalk and ERF-number field
- **Done when:**
  - [ ] the `SalesforceReader` interface has fake and jsforce implementations
  - [ ] delta sync job (15 min, advisory lock) fills `sf_opportunity_snapshot` and `customer`
  - [ ] live search endpoint for the intake picker
  - [ ] ERF number + quote source captured
  - [ ] `integration_run` logged
  - [ ] works against the UAT org
- **Prompt:** `prompts/B-06-salesforce-reader.md`

### B-07: Guided intake wizard (F-03) · **Fri Oct 23** · Ben
- **Why:** intake quality is the #1 engineering constraint (DF-11, DF-18). This is the KAM's first impression.
- **People:**
  - **M4 (Tue Oct 20)**: Jim Zweifel, Danielle Leu, a sales leader and Jordan Albin validate the field set
  - **R1 (Fri Oct 23)**: KAM review
- **Done when:**
  - [ ] 4-step wizard: Opportunity → Customer & ship-to → Product & volume → Drawing & notes / review
  - [ ] only Sales-knowable fields; no plant, process, machine, capital, engineer or priority
  - [ ] existing vs not-yet-established customer
  - [ ] ship-to auto-fills and can be overridden with a reason
  - [ ] the drawing prompt never blocks
  - [ ] drafts autosave
  - [ ] submit creates `CCQ-2026-NNNNN` in Intake with an audit trail
  - [ ] mobile usable
- **Prompt:** `prompts/B-07-intake-wizard.md`

### B-08: Prioritization engine + G1 qualification (F-05, CR-10/11) · **Mon Oct 26** · Ben
- **Why:** engineering needs a ranked queue, and leadership wants a qualify decision before engineering spends effort.
- **People:** M4 outcome (attribute set, interim G1 decider). The Knowledge Steward (unassigned) eventually owns the weights; until then Bailey approves the provisional weights.
- **Done when:**
  - [ ] scoring model v1 is config-driven: 7 PRD attributes, each mapped to 0–100 through bands, weighted, with tiers Low / Standard / High / Critical
  - [ ] the score explanation breakdown shows in the UI
  - [ ] the score recalculates when inputs change and records the model version
  - [ ] min value/volume **warnings**
  - [ ] G1 decision screen for the SalesLeader with Advance / Hold / Rework / Redirect / Stop, reason codes and note rules
  - [ ] G1 can be disabled by config
- **Prompt:** `prompts/B-08-scoring-and-g1.md`

### B-09: Governed overrides, activity timeline, usage audit (F-06, F-08, F-12) · **Tue Oct 27** · Ben
- **Why:** these are cross-cutting controls used by every later stage. Building them once means later stages just call them.
- **People:** a decision on who approves overrides (blueprint gap). Interim: SalesLeader for priority, EngLead for queue position. Confirm in R1.
- **Done when:**
  - [ ] generic override service: request → approve/reject → apply → one-click revert; the original value is preserved and a justification is required
  - [ ] priority tier and ship-to wired up
  - [ ] the timeline on quote detail shows stage changes, gate decisions, overrides, uploads and comments
  - [ ] every quote view and export writes an `audit_event`
  - [ ] the override log is visible to Leadership/Admin only
- **Prompt:** `prompts/B-09-overrides-timeline-audit.md`

---

## Phase 2: Workflow stages (Oct 28 – Nov 2)

### B-10: Engineering queue and Engineering Review (F-04, F-07 queue, CR-14/15/19, DEC-26) · **Wed Oct 28 – Thu Oct 29** · Ben
- **Why:** engineering is the binding constraint. A visible, aged, prioritized queue is the MVP's biggest value.
- **People:**
  - **R2 (Thu Oct 29)**: Jim Zweifel, Faron Ipox, Jeffrey Pitrak, Danielle Leu
  - Paul Slomkowski (optional) for the BOM/capital fields
- **Done when:**
  - [ ] queue shows every quote past G1, sorted by tier/score then age, with time-in-queue and time-in-stage
  - [ ] the EngLead gets an alert on arrival (in-app now, email in B-18)
  - [ ] assign/reassign is recorded
  - [ ] accept / return to KAM (reason required)
  - [ ] Eng Review form: process, machine, plant/site, cavitation, cycle time, prelim capital (commercial field), downstream equipment notes
  - [ ] **capacity evidence** sub-form (site, line/asset, assumed effectiveness %, cycle time, utilization, buffer, analysis date; no OEE default)
  - [ ] G2 outcomes: Proceed / Proceed with risk / Capital required / Hold / Rework / Stop
- **Prompt:** `prompts/B-10-engineering-queue-review.md`

### B-11: Quoting stage (Pricing) (F-11 context, CR-26) · **Fri Oct 30** · Ben
- **Why:** pricing is a required gate (DEC-19/20), and the price approval has to be recorded in CCQ instead of free-text notes.
- **People:** **M5** (pricing route), **R3** (Gemma Cebolla + pricing analyst).
- **Done when:**
  - [ ] Pricing queue (quotes in QUOTING)
  - [ ] pricing record: price approved by and date, pricing-app references (ERF/BPR #), approved-range note, capital readiness (not required / pending / pre-approved / not approved)
  - [ ] no editable price figures
  - [ ] G3 submit to Final Review
  - [ ] Pricing can't approve Final Review
  - [ ] commercial fields are redacted for other roles (tested)
- **Prompt:** `prompts/B-11-quoting-stage.md`

### B-12: Final Review (G4 internal approval) (F-16 as a P0 decision record, CR-29) · **Fri Oct 30** · Ben
- **Why:** the internal "do we stand behind this offer" decision. It has to stay **separate** from the customer outcome (fixes X-88).
- **People:** the Final Review approver(s) from the **D-pack (needed by Oct 28)**. Without a decision, seed a provisional `SG-CCQ-Approver` membership confirmed by Darren.
- **Done when:**
  - [ ] Approvals queue
  - [ ] Approve → CUSTOMER_DECISION, setting proposal issued date and validity date
  - [ ] Decline needs a note + reason code and closes as DECLINED, or Return sends it to the affected stage
  - [ ] the approver can't be the quote's KAM (segregation check)
- **Prompt:** `prompts/B-12-final-review.md`

### B-13: Customer decision, outcome closure, validity, minimal hand-off (CR-37/39/41) · **Mon Nov 2** · Ben
- **Why:** 71% of FY26 outcomes are unrecorded today. Making outcome and reason mandatory is how win rate becomes measurable.
- **People:** the D-15 taxonomy (Sarah/Darren via Bailey); R3 for the hand-off fields (Amanda Cronkhite optional).
- **Done when:**
  - [ ] outcomes: Awarded / Lost / Expired (no response) / On hold (review date required) / Re-quote (versioned return to the affected stage)
  - [ ] reason code + closure owner + date are mandatory to close
  - [ ] "silence ≠ loss" (expired is a distinct state)
  - [ ] validity countdown with an expired flag
  - [ ] Awarded captures acceptance evidence, CER ID, BPR ID and receiving role
  - [ ] the SF stage is shown side by side, with a mismatch flag
- **Prompt:** `prompts/B-13-outcome-closure-handoff.md`

---

## Phase 3: Views, integrations, insight (Nov 3–6)

### B-14: Pipeline board, quote list, approvals and prioritization views, export (F-07) · **Tue Nov 3** · Ben
- **People:** none new (validated in R1–R3).
- **Done when:**
  - [ ] kanban by stage (drag only where a transition is allowed, opening the gate dialog)
  - [ ] Quotes list
  - [ ] Approvals and Prioritization views
  - [ ] search + Filters popover + inline sort; saved filters in URL
  - [ ] CSV export (scoped, redacted, audited)
  - [ ] all views mobile usable
- **Prompt:** `prompts/B-14-board-and-lists.md`

### B-15: Pricing application read connector (F-11) · **Wed Nov 4** · Ben
- **People:** **M5 (Oct 21)**: Cory McGahan (DB access), Gemma Cebolla (scope and sensitivity), Brennan Paul (if the Fabric route).
- **Done when:**
  - [ ] `PricingReader` interface has fake + real implementations (route A or B)
  - [ ] look up ERF/BPR by number and by customer
  - [ ] pricing context panel on the Quoting stage (read-only, commercial-redacted)
  - [ ] SPR shown as history only
  - [ ] `integration_run` logged
  - [ ] falls back to manual references when the reader is unavailable
- **Prompt:** `prompts/B-15-pricing-reader.md`

### B-16: Document attachments to SharePoint (F-13) · **Wed Nov 4** · Ben
- **People:** **M7 (Oct 27)**: the SharePoint admin grants `Sites.Selected`; Bailey confirms the folder structure.
- **Done when:**
  - [ ] upload from intake and any stage, streamed through the API to `/CCQ/{quote_number}/`
  - [ ] list/download in the quote
  - [ ] type/size limits
  - [ ] uploading a drawing sets `drawing_status`
  - [ ] audited
  - [ ] Blob fallback implementation behind the same interface
- **Prompt:** `prompts/B-16-sharepoint-attachments.md`

### B-17: Role dashboards and operational analytics (F-02 complete, F-17 subset, CR-55) · **Thu Nov 5** · Ben
- **People:** **M6 (Oct 22)** with D&A for definitions; R3 for the leadership view.
- **Done when:**
  - [ ] **KAM:** my pipeline, my drafts, returned-to-me
  - [ ] **EngLead:** queue health (count, aging buckets, unassigned)
  - [ ] **Pricing:** quoting queue
  - [ ] **Approver:** pending approvals
  - [ ] **Leadership:**
    - pipeline value by stage
    - median time in stage
    - outcome capture rate
    - win rate (decided only, shown with the capture rate)
    - priority distribution
    - override frequency
  - [ ] labelled "operational, not D&A-certified"
- **Prompt:** `prompts/B-17-dashboards-analytics.md`

### B-18: Notifications (P0 minimum: assignment alerts, in-app + email) · **Thu Nov 5** · Ben
- **People:** M7, for the shared mailbox and application access policy.
- **Done when:**
  - [ ] in-app bell with unread count
  - [ ] events: new item in the engineering queue (to EngLead), assigned (to engineer), returned (to KAM), awaiting approval (to Approver), G4 decided (to KAM)
  - [ ] email via Graph for the same events, with per-user opt-out
  - [ ] failures logged and an owner alert raised
  - [ ] Teams digest and SLA/stale alerts deferred to P1
- **Prompt:** `prompts/B-18-notifications.md`

### B-19: Admin configuration console (CR-51) · **Fri Nov 6** · Ben
- **People:** the Knowledge Steward (unassigned). Bailey acts as interim approver of config values.
- **Done when:**
  - [ ] Admin screens for value lists, reason codes, stage/gate labels, app settings, scoring model (new version with change reason; never edit in place), user scope view
  - [ ] every change is versioned and audited, forming a minimal decision log (F-21 seed)
- **Prompt:** `prompts/B-19-admin-config.md`

---

## Phase 4: Harden, load, UAT, sign-off (Nov 6–13)

### B-21: Security, access and quality hardening · **Fri Nov 6** · Ben
- **People:** **M8 (Oct 30)**; IT security for U4 (Nov 11).
- **Done when:**
  - [ ] permission-matrix tests cover **every** route × role (allowed and denied)
  - [ ] RLS tests
  - [ ] redaction tests
  - [ ] CSP/helmet, rate limits, upload limits
  - [ ] `pnpm audit` and gitleaks clean
  - [ ] a11y pass (axe) on the core flows
  - [ ] mobile pass at 390 px
  - [ ] load test (k6): 50 users, p95 < 400 ms
  - [ ] runbook draft
- **Prompt:** `prompts/B-21-hardening.md`

### B-22: Production data load and UAT environment prep · **Fri Nov 6** · Ben + IT/D&A
- **People:** **M9 (Nov 2)** confirms production-data approval (Oliver Kade, Brennan Paul); Rachel Dew switches the integration user to production; Bailey confirms the UAT cohort and IT adds them to groups.
- **Done when:**
  - [ ] prod environment deployed
  - [ ] SF prod sync run and reconciled (count vs the SF report)
  - [ ] value lists approved, or flagged provisional
  - [ ] UAT users can sign in with the correct roles
  - [ ] synthetic data purged from prod
- **Prompt:** `prompts/B-22-prod-data-uat-env.md`

### B-23: UAT pack, in-app feedback, training aids · **Mon Nov 9 – Thu Nov 12** · Ben + Bailey
- **People:** UAT cohort (U1–U3), Bailey runs the sessions.
- **Done when:**
  - [ ] UAT scripts per role (in `docs/uat/`)
  - [ ] in-app "Report an issue" button that creates a feedback record with page + quote context
  - [ ] a 1-page quick-start per role
  - [ ] defect triage board
  - [ ] all Sev-1/2 defects fixed by Thu Nov 12
- **Prompt:** `prompts/B-23-uat-pack.md`

### B-24: Gate package and hand-off documentation · **Thu Nov 12 – Fri Nov 13** · Ben + Bailey
- **People:** U6 sign-off attendees.
- **Done when:**
  - [ ] solution design (from `01-architecture.md`)
  - [ ] requirements traceability matrix (PRD + CR → step → test)
  - [ ] test results
  - [ ] defect log
  - [ ] runbook + support model
  - [ ] release notes
  - [ ] P1/P2 backlog
  - [ ] signed UAT
- **Prompt:** `prompts/B-24-gate-package.md`

---

## Post-MVP backlog (P1 / P2, not before Nov 13)

| Item | Priority | Blocked by |
|---|---|---|
| Teams digest; SLA and stale-quote alerts | P1 | D-20 thresholds after baseline |
| Rules-based engineering routing | P1 | Pilot learning; D-19 |
| Ranger AI assist (suggested score, missing fields, drawing inference, similar quotes) | P1 | Contract execution (X-86); D-22 |
| Guided onboarding walkthrough per role | P1 | — |
| Fabric mirroring + D&A-certified analytics | P1 | Brennan Paul |
| MCP / API for Copilot and Cowork agents, user-scoped | P2 | IT agent-identity pattern |
| Full decision log and corrections ledger | P2 | Knowledge Steward |
| Post-award hand-off view (Nicole, Anne) | P2 | D-14 |
| Visit-to-win analysis | P2 | — |
| Salesforce write-back | Decide before scale | D-16 |
| CER / BPR integration | Scale | Capital-system redesign (Jan) |
