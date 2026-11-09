# 05: Path to MVP: Connect, Validate, Sign Off

**The short version of what's left.** The app is built on synthetic data (B-01 to B-19). What remains is mostly *other people's* work: access grants, real data, business decisions and user feedback. This page lists that work in the order to do it, who to meet, and what each meeting must produce.

- No dates here on purpose. Put them in your own calendar.
- The detail lives in the other files: build steps in `03-build-steps.md`, open decisions in `04-decisions-and-risks.md`, people in `02-schedule-and-meetings.md` §1. Keep updating those; update this page when a step is done (tick its box) or the order changes.

---

## 1. Where we stand

| Area | Status | What it's waiting on |
|---|---|---|
| Core app: intake, G1, engineering queue and review, quoting, Final Review, outcome, hand-off, board/lists, dashboards, notifications, admin console | ✅ **Built and tested on synthetic data** | User feedback and business decisions (all open rules ship as provisional config) |
| Sign-in (Microsoft Entra) | ✅ **Live on test** since 2026-10-21 (two app registrations, `CCQ.*` roles, `SG-CCQ-*` groups) | Confirm `CCQ.PricingLead` (B-26, the ninth role) exists in Entra with its group; real UAT users added to groups (B-22) |
| Azure hosting (test + prod) | 🟡 **Test live** at `https://quoteflow-test.azurewebsites.net` since 2026-10-21, deployed from `main` on every merge. Bicep for both envs in `infra/` (2026-10-27), **not yet applied; no what-if is on record** (the test parameter file still has `<confirm: …>` placeholders). Test is already on General Purpose Postgres (D-FB3 done 2026-11-03) | Ben, from his PC with `az`: fill the placeholders, run and record the test what-if, apply (`03` B-20 "Azure steps"). IT: prod resource group, names and approvals (B-22) |
| Salesforce read | ✅ **Live on the production org** since 2026-10-24 (client credentials, read-only integration user; real field names; every opportunity kept, L-7; scoped per user, L-6) | Zac / Graham to confirm field meanings (`TODO(M3)` in `fieldMap.ts`) and D-18; prod sync reconciled to the SF report at B-22 |
| Pricing history | 🟡 **Import built** (B-15, revised 2026-10-22): no live connection; Cory's export is imported by an Admin | Import the export in test, then prod (B-22); Gemma's sensitivity confirmation |
| SharePoint attachments | 🟡 Built; Blob or local store until M7 | Site, library and `Sites.Selected` permission |
| Email notifications | 🟡 Built; in-app works, email goes to a fake | Shared mailbox + `Mail.Send` permission |
| Fabric data landing (L-8: all new QuoteFlow data stored in the Fabric tenant; B-27) | 🟡 Mirroring plan **accepted by Brennan Paul (2026-10-26)**. Code side built: mirror-safe schema + CI guards, analytics T-SQL twins, deploy stop/start, hourly health check. **Test mirror proven to work** (Ben, 2026-11-06; test Postgres on General Purpose since 2026-11-03) | Record the tie-out (row counts, latency, IDs); test column security both ways; exercise the deploy stop/start once; set `FABRIC_*` IDs. Then D-FB2, D-FB4, D-FB5 and the prod gateway with Brennan Paul + IT (B-22) |
| Security hardening (B-21) | 🟡 Route × role matrix over all 115 routes, RLS, redaction, axe and 390 px tests, CSP, upload limits and a per-user rate limit in place; health alerts in the Bicep (not yet applied); k6 load test built (local p95 298 ms) | Load test against test (re-run: FB-01 to FB-05 changed the read paths); M8 security review |
| Prod data load (B-22) | 🔴 Not started | Prod environment from IT; written prod-data approval (D-23) |
| UAT pack (B-23) | 🟡 **Built** 2026-10-26: "Report an issue", Admin → Feedback, `pnpm uat:defects`, 8 role scripts and quick-starts in `docs/uat/` | Bailey's review by Fri Nov 6; real opportunities in the scripts |
| User feedback updates (FB-01 to FB-10, tracker Nov 5) | 🟡 **In progress** 2026-11-05: **Wave 1 built (FB-01, FB-02, FB-03; merged in that order)**. **FB-01**: section locks after G2 / G3 / G4 (F-001), Pricing → KAM send-back (F-029) with the KAM's fix going straight back to Quoting unless the scope changed (F-030), the Final Review approver no longer blocked by terms / Legal (F-069, `g4_required_checks = []` provisional), notes on every exception decision (F-027); F-003 / F-004 / F-028 verified by tests (T-014–T-016). **FB-02** (intake overhaul: Salesforce front door, product facts, drawings and mold changes, F-007…F-075, T-003) and **FB-03** (engineering review and capacity: utilization before / after, capacity export, budgetary capital). **FB-04** (qualification, funding wording, Salesforce link: F-065 sales-leader-only priority override, F-005 golden score test with no defect found, F-073 strategic-fit mechanism with no points, F-022 / V-055, F-076) merged. **FB-05** (notifications for hand-offs, returns, holds, closures and comments: F-079, F-034; T-010, T-014, T-037) merged 2026-11-06. **2026-11-09:** D-001 decided (costing, then ROI, then price confirmation) and Pricing's intake asks recorded (D-031 to D-033), so **FB-07** and the new **FB-11** (intake commercial inputs) are ready, and **F-058** of FB-06. FB-08 is partly gated (D-003, D-029, A-012, A-035); FB-09 and FB-10 wait on D-016, D-006 and D-004; the rest of FB-06 waits on D-007 and D-008. See §8 | Ben to run FB-11, FB-07 and F-058; Kal's blank template (A-030), the costing and ROI templates (A-031), a Finance role in Entra (A-032); the decision session with Oleg for D-004, D-006 and D-002 |
| Gate package (B-24) | 🟡 Drafts in `docs/gate/` (runbook, traceability, release notes, backlog, test results) | Update at sign-off; Bailey reconciles traceability against PRD v1 |

**Bottom line (updated 2026-10-27):** nothing a user sees is blocked on code. Test runs live on Azure with Entra sign-in and production Salesforce data. Every remaining item is blocked on a person, an access grant or a decision. That's why the order below is driven by **lead time**, not by how the app flows.

---

## 2. The order and why

```
1. Unlock the platform      →  2. Connect real data       →  4. Harden + go-live readiness  →  5. UAT + sign-off
   (approval, Azure, Entra)     (SF, pricing, SharePoint,      (security, support, prod data)
                                 mail, data dictionary)
                            ↘  3. User feedback, in workflow order (intake → engineering → pricing/approval/outcome)
                                 + the business decision package
```

**Why this order:**

1. **Platform first.** Azure and Entra have the longest IT lead time, and without them there is no test URL for anyone to try and no real sign-in. Every day this slips moves UAT by a day. There's no fallback.
2. **Ask for every integration's access at the same time, early.** Each one waits on a different person (Rachel, Cory, the M365 admin). Asking in parallel means the waits overlap. The app works without them, so nothing else stalls while you wait.
3. **Feedback runs alongside step 2, not after it.** Reviewers can react to the app on synthetic data. Run the sessions in the order a quote moves (intake first), because changes upstream (e.g. intake fields) ripple into later stages. Real Salesforce data makes the sessions better, so if it arrives in time, use it.
4. **Hardening after feedback.** Feedback changes screens and rules. Security tests, the prod load and the UAT pack should be built on the version people have agreed to.
5. **UAT last, on approved data.** UAT only counts for MVP if it runs in Azure with real (approved) data and real sign-in.

---

## 3. Step by step

Each step: **who**, **what the meeting must produce** (your checklist for the meeting), and **what Ben does after**.

### Phase 1: Unlock the platform

#### Step 1. Hosting and data approval (Gate 2) · *M1*
- **Who:** Darren Miller, Oliver Kade (VP IT), Brennan Paul (D&A). Optional: Chris O'Brien, Tre Curry.
- **Why first:** IT won't provision without approval, and production data can't load without D&A sign-off. Both have the longest lead time.
- **Leave the meeting with:**
  - [x] Azure hosting approved (App Service + PostgreSQL + Key Vault + App Insights, test and prod resource groups). Oliver Kade.
  - [x] a named IT person who provisions it, and a date. Vincent Brown; test environment provisioned at M2, first deploy 2026-10-21.
  - [ ] the path to production-data approval, including what to do with the **~205 live Salesforce records in Bailey's prototype** (purge or approve). 2026-10-23: Ben reports IT and D&A approved production data, and test has run on the production Salesforce org since 2026-10-24 (D-23). Still open: the written approval (approvers and date) and the prototype's copy.
  - [x] support: **EI supports** (Ben, 2026-10-21). This replaces the proposed "EI builds, IT hosts and supports".
  - [x] the access pattern for **test**: the public `*.azurewebsites.net` URL with Entra sign-in is fine (Ben, 2026-10-21). The production pattern is decided at M8.
- **Bring:** the 1-page hosting proposal (`01-architecture.md` §1, §7, §8) and a cost estimate.
- **After:** file or update the IT tickets (`02` §4).

#### Step 2. Entra and Azure working session · *M2*
- **Runbook:** [`06-azure-entra-setup.md`](06-azure-entra-setup.md) has every command, labelled IT / Dev.
- **Who:** Vincent Brown (Entra / app permissions), Tim Webb (IT infra), Alicia Avellaneda-Cruz (IT PM). Optional: Tre.
- **Why now:** sign-in, roles and the test environment all hang off this. It also creates the Graph permissions SharePoint and email need later.
- **Leave the meeting with:**
  - [x] two app registrations (SPA + API) with the settings in `03` B-04 notes (v2 tokens, `access_as_user` scope, redirect URIs)
  - [x] the 8 `CCQ.*` app roles and the `SG-CCQ-*` security groups (B-26 later added a ninth, `CCQ.PricingLead`: confirm IT created it and its group)
  - [x] the test resource group, and Ben's access to it
  - [x] GitHub → Azure OIDC trust for deployments (plus a second credential for GitHub's immutable subject format, `06` B8)
  - [ ] the Graph permissions requested (`Sites.Selected`, `Mail.Send` limited to the CCQ mailbox). **Not done at M2** (checked 2026-10-21: QuoteFlow-SPA has only the sign-in permissions, QuoteFlow-API has none). Moved to **M7**. Not blocking: attachments go to Blob and email is off until then.
- **After (build):** **B-20** (Bicep + deploy pipeline, first deploy to test), then switch sign-in to Entra. From here on, every review uses the test URL.
- **Done 2026-10-21:** first deploy to `https://quoteflow-test.azurewebsites.net` with Entra sign-in. Bicep is still open (`03` B-20).

### Phase 2: Connect real data

Request all four of these as soon as Step 1 is done. They can run in any order; the order below is by importance.

#### Step 3. Salesforce · *M3*
- **Who:** Rachel Dew (Salesforce admin), Zac Cairns (knows the SF objects), Graham Parle (Sales Ops). Optional: Cory McGahan.
- **Why first of the integrations:** every quote starts from a Salesforce opportunity. It's on the "never cut" list, and real opportunities make every later review more convincing.
- **Leave the meeting with:**
  - [x] a **read-only** integration user. Done differently: an **External Client App** with the client credentials flow, straight on the **production org** (production data approved, D-23), live since 2026-10-24
  - [x] the real API names for every custom field: read with `describe()` (`fieldMap.ts`, 2026-10-24). Zac / Graham still confirm what some fields *mean* (`TODO(M3)` in the file)
  - [x] which field holds the ERF number: `ERF_Number__c` (free text; the ERF linkage report shows how reliable it is)
  - [ ] the source of truth for customer and ship-to: SF Account or ERP (D-18). MVP default: SF Account
  - [x] which SF stages count as "won" / "lost": all 14 stages mapped in `sf_stage_map` (migration 0020)
- **After (build):** done 2026-10-24: `fieldMap.ts` filled in, `SF_MODE=live` on test. Still to do: reconcile the prod sync against the SF report (B-22).

#### Step 4. Pricing history · *done differently (2026-10-22)*
- **Who:** Cory McGahan (the export), Gemma Cebolla (Sr Dir Pricing).
- **What changed:** no live connection. The pricing app is unsupported and being retired as QuoteFlow takes over its job, so its history is Cory's export (approved), imported by an Admin (Admin → Integrations → Pricing history). The route question (A/B), the view names and the formats are settled by the export itself.
- **Still to do:**
  - [x] the real ERF format (ERF<yy>-<n>, EP<yy>-<n> for older ERFs): in `pricing_ref_formats`
  - [ ] import the export in test (Admin), then in prod at B-22
  - [ ] Gemma's confirmation of **who may see pricing history, pricing, margin and capital** (today: Pricing, PricingLead, Eng leads, Approver, Leadership, Admin) and the B-15 open points (net capital 0, BPRs on the history page only)
  - [ ] whether Cory takes a final export when the old app is switched off, and what happens to in-flight ERFs (D-30)

#### Step 5. SharePoint and email · *M7*
- **Who:** the IT SharePoint / M365 admin, Bailey (folder structure), Tre.
- **Why:** attachments and email alerts. Both have fallbacks (Azure Blob storage; in-app alerts only), so this is last of the access requests.
- **Leave the meeting with:**
  - [ ] the SharePoint site and library, with `Sites.Selected` (write) granted on that site only, plus a test site
  - [ ] the folder convention agreed with Bailey (`CCQ/{quote_number}` today, or whatever the ERF restructure for Ranger needs)
  - [ ] confirmation that malware scanning (Defender) is on for that site, and a retention rule for removed files
  - [ ] the shared mailbox (`ccq-noreply@`) and the `Mail.Send` access policy limited to it
- **After (build):** set the site/library and mail settings, send one real email, run the live SharePoint test.

#### Step 6. Data dictionary and metric definitions · *M6*
- **Who:** Brennan Paul (or a D&A analyst), Zac Cairns, Graham Parle.
- **Why:** leadership will judge the dashboards. Agree the definitions before they see numbers, so the conversation is about the business, not the math.
- **Leave the meeting with:**
  - [ ] each MVP field's owner, source and allowed values agreed
  - [ ] the dashboard definitions accepted, or changes listed: win rate (Expired is not a loss), capture rate, cycle time minus holds, time windows
  - [ ] agreement that MVP dashboards are labelled "operational, not certified"
  - [ ] ~~the post-MVP plan to copy CCQ data into Fabric~~ superseded by L-8: the copy is now MVP work (Step 6a)
- **After (build):** small SQL edits in `packages/db/sql/analytics/`.

#### Step 6a. Fabric data landing · *MF* (added 2026-10-24)
- **Who:** Brennan Paul + the D&A engineer who'll own the workspace; Oliver Kade or Tim Webb (IT); Oleg Yarovinski optional.
- **Why:** L-8 (Oleg + Brennan): all new data QuoteFlow creates is stored in Pretium's Fabric tenant. The plan is Fabric mirroring of the CCQ Postgres database (`01-architecture.md` §6.1). It's mostly Azure and Fabric setup with long-ish lead times (capacity, tenant settings, a server restart, a VNet data gateway for prod), so ask early.
- **Leave the meeting with:**
  - [x] D-FB1: a continuous mirror is enough; Postgres stays the app's store (Brennan Paul accepted the mirroring plan, 2026-10-26)
  - [ ] D-FB2: the table list (SF snapshot and pricing history in or out)
  - [ ] D-FB3: test Postgres moves off Burstable (cost approved)
  - [ ] D-FB4: workspace per env, capacity, item owner (service principal), tenant settings on, who reads commercial columns, latency target
  - [ ] D-FB5: whether a running prod mirror is part of the Nov 13 bar
  - [ ] IT: a restart window for the mirroring parameters; the prod gateway subnet
- **After (build):** B-27. Built 2026-10-26: `_json` companions + CI guards, deploy-time stop/start, the status check and the T-SQL twins. Still to do: Bicep changes, set `FABRIC_WORKSPACE_ID` / `FABRIC_MIRRORED_DB_ID` (GitHub `test` environment variables + App Service settings), the test mirror tie-out; prod with B-22.
- **Bring to MF:** D&A must mirror `audit_event_fabric` (audit JSON copies) and `sf_opportunity_snapshot` (the analytics twins read it). The deploy identity needs **Contributor** on the workspace; the app's managed identity needs **read** on the mirrored item.

### Phase 3: User feedback (run alongside Phase 2)

Run these in the order a quote moves. Each session: a short live demo, then the questions. Record what you hear in the matching step of `03-build-steps.md` and fix within days, not at the end. **See §4 for exactly what to show and ask in each.**

#### Step 7. Intake and qualification rules · *M4*
- **Who:** Jim Zweifel (upfront engineering lead), Danielle Leu (Product Commercialization), a sales leader (Matt Graden or Jack Gordon's delegate), Jordan Albin (KAM). Run with Bailey.
- **Why first:** intake quality is engineering's #1 complaint, and every later stage uses what intake captures.
- **Leave the meeting with:** the final intake field list and which fields block submit; who decides G1; the scoring attributes (advisory only); whether value/volume screens are warnings and at what numbers.

#### Step 8. KAM usability review · *R1*
- **Who:** Jordan Albin plus 1 to 2 KAMs (e.g. Linda Vinegar, Josh Edmonson), a sales leader, Danielle Leu. Run with Bailey.
- **Why:** if KAMs see this as "a second tool", adoption fails. They are the people who must use it every day.
- **Leave the meeting with:** a list of usability fixes; who approves priority and ship-to overrides (D-OA); whether KAMs may see peers' priority scores.

#### Step 9. Engineering review · *R2*
- **Who:** Jim Zweifel, Faron Ipox (capacity), Jeffrey Pitrak (supply chain / capacity), Danielle Leu. Optional: Paul Slomkowski.
- **Why:** the engineering queue is the core of the MVP and the main bottleneck the app is meant to fix.
- **Leave the meeting with:** the G2 fields and capacity evidence confirmed; who backs up Jim as assigner; whether engineers see capital figures on their own quotes.

#### Step 10. Pricing, Final Review, outcome and hand-off · *R3*
- **Who:** Gemma Cebolla + a pricing analyst, Jennifer Solomon (Finance cost-to-serve), the Final Review approver candidate(s), Matt Graden. Optional: Amanda Cronkhite (hand-off), Nicole Donnelly / Anne DeSmet.
- **Why last:** these are the last stages a quote reaches, and they depend on the approver and outcome decisions in Step 11.
- **Leave the meeting with:** the G3 submit rules; the G4 approval rules; the outcome reason codes; validity; the hand-off fields.

#### Step 11. Business decision package (async)
- **Who:** Bailey prepares; Sarah Brennan decides; Darren and Oleg Yarovinski consulted.
- **Why now:** these decisions are already built as provisional settings, so the app won't wait. But UAT should test the **real** rules, so they need to land before Phase 4.
- **Decisions needed:**
  - [ ] **D-10** who approves at Final Review (names for `SG-CCQ-Approver`), and any approval tiers
  - [ ] **D-15** outcome categories, reason codes and who closes the quote
  - [ ] **D-12** quote validity default (30 days today), and whether "revalidate without re-quote" is needed
  - [ ] **D-11** what "capital ready" means before Final Review (add to `04`)
  - [ ] **D-K1** can KAMs see peers' priority scores
  - [ ] **D-02** Process Owner and Knowledge Steward (who approves config changes after go-live)
  - [ ] **Gate owners:** confirm who decides each gate. Today that's in code; making it editable in the admin console is a security change (see B-19 note).
- **After (build):** Admin enters each decision in the admin console and marks it approved. No code change.

### Phase 4: Harden and get ready to go live

#### Step 12. Security hardening (build) · *B-21*
- **Who:** Ben.
- **Why now:** on the version stakeholders have agreed, so the tests cover the final screens and rules.
- **Work:** permission tests for every route and role, RLS and redaction tests, rate/upload limits, dependency and secret scans, accessibility and 390 px mobile pass, a 50-user load test, the runbook draft.
- **Status (2026-10-27):** most of this is built; see `03-build-steps.md` B-21. Left: the load test against test, then M8. The runbook draft is `docs/gate/runbook.md`.

#### Step 13. Security review · *M8*
- **Who:** Oliver Kade (or an IT security delegate), Chris O'Brien. Optional: Tre.
- **Why:** this is the input to the Gate 3 design sign-off, and IT won't host it in production without it.
- **Leave the meeting with:**
  - [ ] the threat model, permission matrix, RLS and audit approach accepted, or a list of fixes
  - [ ] the plan for the light pen test during UAT (U4)
  - [ ] the production access pattern confirmed

#### Step 14. Support model and production data · *M9*
- **Who:** Oliver Kade, Chris O'Brien, Tim Webb, Alicia Avellaneda-Cruz, Darren. Then a short follow-up with Bailey for the UAT cohort.
- **Why:** production data and a support owner are the last two things that decide whether MVP counts.
- **Leave the meeting with:**
  - [ ] **production-data approval confirmed** (if not: UAT runs on the SF UAT org and is "UAT-ready on masked data")
  - [ ] who's on call, the runbook accepted, prod deploy approvals, backup/restore, the hypercare window
  - [ ] Rachel Dew asked to switch the integration user to production
  - [ ] the UAT cohort named by role, and their group membership requested from IT

#### Step 15. Production load and UAT pack (build) · *B-22, B-23*
- **Who:** Ben (+ Bailey for the UAT pack).
- **Work:** deploy prod, run and reconcile the Salesforce prod sync, purge synthetic data, check UAT users sign in with the right roles; write the UAT scripts and a 1-page quick-start per role; add the in-app **"Report an issue"** button; set up the defect board.

### Phase 5: UAT and sign-off

#### Step 16. UAT sessions · *U0–U5*
- **Who / what:**
  - **U0** all testers: how to test and report issues
  - **U1** KAMs + sales leader: intake, G1, outcome
  - **U2** Jim's team + Faron: queue, Engineering Review, capacity, G2
  - **U3** Pricing, approver, leadership: quoting, Final Review, dashboards, override log
  - **U4** IT security: access test (pen test light)
  - **U5** Zac, Graham, D&A: tie-out, spot-checking CCQ against Salesforce and the pricing app
- **Goal:** every P0 feature passes with the real gate-owner candidates; all severity 1 and 2 defects fixed.

#### Step 17. Sign-off · *U6, B-24*
- **Who:** Darren, Bailey, Tre, Ben, gate-owner candidates (Jim, Gemma, the approver), Oliver / IT.
- **Leave the meeting with:** signed UAT and the Gate 4/5 package accepted (design, traceability, test results, defect log, runbook, release notes, P1/P2 backlog). **That's MVP.**

---

## 4. Feedback to collect, by part of the app

Use this as the agenda for Steps 7 to 10. "Today" is what the app does now (provisional, all changeable in the admin console unless marked *code*).

| Part of the app | Session | Questions to ask | Today |
|---|---|---|---|
| **Intake wizard** (4 steps) | M4, R1 | Is this the right field list? Which fields must block submit? Is neck finish and packaging right? Is it faster than the ERF? Does it work on a phone? | Blocks on: SF opportunity, customer, ship-to, product family, resin, volume. Everything else is a warning |
| **Priority score** | M4, R1 | Right 7 attributes? Do the tiers look right on real examples? Can KAMs see each other's scores? | PRD attributes, neutral weights, advisory only; peers' scores visible |
| **G1 qualify** | M4 | Who decides? Should value/volume minimums warn, and at what numbers? Can a sales leader qualify their own deal? | Sales leader decides, not on their own deals; no minimums set |
| **Overrides** (priority, ship-to, queue position) | R1 | Who approves each? Is the justification rule right? | Priority: sales leader or eng lead. Ship-to: KAM, logged. Queue: eng lead |
| **KAM home page** | R1 | Is this what a KAM needs on Monday morning? | Drafts, returned work, open quotes, expiring proposals, capture rate |
| **Engineering queue** | R2 | Is the sort order right? Are 3 / 10 business days the right aging buckets? Who backs up Jim? Should accept be lead-only? | Tier, then score, then age; no backup named |
| **Engineering Review + capacity evidence** | R2 | Right fields per process (e.g. assembly has no cavitation)? Does "Capital required" need capacity evidence? Should engineers see capital figures on their own quotes? | Process, machine, plant, cavitation, cycle time + 1 capacity row; engineers can't see numbers |
| **Pricing record (G3)** | R3 | Should "costing completed" be required? Should "capital not approved" block? Does Pricing want its own queue aging? Should Pricing be able to correct the ERF number? | Warns, doesn't block; borrows engineering's buckets |
| **Final Review (G4)** | R3, D-pack | Who approves? Tiers by capital or revenue? | Any member of the Approver group; not the KAM or the price approver |
| **Outcome + validity** | R3, D-pack | Right reason codes? Allow "Expired" before the validity date? Is the SF stage-mismatch flag too noisy? 30-day validity? | Provisional codes; expired early needs a note; flag only on outcomes |
| **Hand-off record** | R3 (Amanda) | Are these the fields Commercial Activation needs? | Evidence, CER/BPR IDs, receiving role/contact, date |
| **Notifications** | R2, R3 | Right people alerted for each event? Should the 7 AM digest skip weekends? | Arrival, assign, return, approval and G4 alerts; digest every day |
| **Dashboards + analytics** | M6, R3 | Are the definitions right? Is 50% the right "low capture" line? Who sees the adoption report? | Labelled "operational, not certified" |
| **Pipeline board, list, export** | R1, R3 | Should "age" mean the same thing everywhere (calendar vs business days)? Is a region filter needed on the list? | Calendar days on the board, business days in the queue |
| **Admin console** | Bailey | Who owns config after go-live (Knowledge Steward)? | Bailey approves as interim Admin |

---

## 5. Integrations checklist

| Integration | Who grants access | What we need from them | Fallback if it slips | Done when |
|---|---|---|---|---|
| **Azure hosting** | Oliver Kade, Tim Webb | Resource groups, OIDC trust | **None.** UAT moves day for day | [x] app deployed to the test URL (2026-10-21) · [ ] prod (B-22) |
| **Entra sign-in** | Vincent Brown | 2 app registrations, 9 roles (B-26 added `CCQ.PricingLead`), groups | Dev mode (not valid for UAT) | [x] real users sign in on test (2026-10-21) · [ ] UAT cohort in the right groups (B-22) |
| **Salesforce** | Rachel Dew (access), Zac / Graham (fields) | Read-only integration user, field API names | **None for MVP** (never cut) | [x] live on the production org (2026-10-24) · [ ] prod sync reconciles to the SF report (B-22) |
| **Pricing history** (B-15: import, no live connection) | Cory McGahan (export), Gemma Cebolla | The export; who may see it | Typed-in Legacy ERF # | [ ] export imported in test, then prod |
| **SharePoint** | IT M365 admin | Site, library, `Sites.Selected` | Azure Blob storage | [ ] live test passes; folder convention agreed |
| **Email** | IT M365 admin | Shared mailbox, `Mail.Send` policy | In-app alerts only | [ ] one real email sent from the mailbox |

---

## 6. Who you need, at a glance

| Person / function | Steps | What you need from them, in one line |
|---|---|---|
| **Darren Miller** (sponsor) | 1, 11, 14, 17 | Approvals, escalation, scope calls |
| **Bailey Schmitt** (product owner) | 5, 7–11, 15–17 | Runs reviews and UAT, decision package, interim config approver |
| **Tre Curry** (coordination) | throughout | Unblocking, tickets, Asana |
| **Oliver Kade** (VP IT) | 1, 13, 14, 17 | Hosting, security, support, prod-data approval |
| **IT: Vincent Brown, Tim Webb, Alicia Avellaneda-Cruz, Chris O'Brien** | 2, 13, 14 | Entra, Azure, tickets, support |
| **IT M365 / SharePoint admin** | 5 | SharePoint site permission, mailbox |
| **Brennan Paul** (D&A) | 1, 4, 6, 6a, 14 | Prod-data approval, data definitions, Fabric data landing (L-8) |
| **Rachel Dew, Zac Cairns, Graham Parle** (Salesforce) | 3, 6, 14, 16 | SF access, field names, tie-out |
| **Cory McGahan** (IT, pricing data) | 4 | The pricing-app export (done; a final one at switch-off?) |
| **Gemma Cebolla** (Pricing) + pricing analyst | 4, 10, 16, 17 | Who sees pricing, G3 rules, pricing UAT |
| **Jim Zweifel** (upfront engineering lead) | 7, 9, 16, 17 | Intake fields, queue, G2, engineering UAT |
| **Danielle Leu** (Product Commercialization) | 7, 8, 9 | Intake and stage definitions |
| **Faron Ipox, Jeffrey Pitrak** (capacity) | 9, 16 | Capacity evidence fields |
| **Sales leader** (Matt Graden / Jack Gordon) | 7, 8, 10, 16 | G1, overrides, outcome ownership |
| **KAMs** (Jordan Albin + 1–2) | 7, 8, 16 | Intake usability, KAM UAT |
| **Final Review approver candidates** | 10, 16, 17 | G4 rules and UAT |
| **Sarah Brennan** (CCO), **Oleg Yarovinski** | 11 (async via Bailey) | Approver, outcome taxonomy, stage model |
| **Jennifer Solomon** (Finance), **Amanda Cronkhite** (hand-off) | 10 | Costing checkpoint; hand-off fields |

---

## 7. If time runs short

The original cut list (`02` §3) is mostly built already, so cutting now means **not connecting** something live. Cut in this order, agreed in advance with Darren:

1. Pricing app: KAMs and Pricing type ERF/BPR numbers by hand.
2. SharePoint: store attachments in Azure Blob instead.
3. Email: in-app alerts only.
4. Analytics: show only time-in-stage and pipeline by stage until D&A agrees the rest.

**Never cut:** sign-in and roles, audit, the stage engine, intake, the engineering queue, gate decision records, outcome + reason codes, Salesforce read.

---

## 8. Remaining steps to MVP (updated 2026-11-09, Ben's plan: every FB step built this week)

**Where we are.** The core app and FB-01 to FB-05 are built and merged. The test site runs on Azure with Entra sign-in and production Salesforce, and the test Fabric mirror works. UAT started today (U0 and U1). Open: FB-06 to FB-11, prod, the rest of UAT and the gate package.

**How every FB step can land this week.** CLAUDE.md rule 4 lets an open decision ship as provisional config that an Admin changes later. So no step waits for a decision: each prompt carries explicit provisional defaults, and a value a person has not supplied ships provisional or inactive and is listed in the config snapshot. The Nov 13 gate then counts these features as built and tested, with their values still provisional where the business has not signed off.

### The schedule

| # | When | Step | Who | What has to be done | Done when |
|---|---|---|---|---|---|
| 1 | Mon Nov 9 | Tracker, then **Wave 4a** | Ben; four Claude Code sessions | Paste the tracker rows (`feedback/tracker-updates-2026-11-09.md`). Start **FB-11** (Sonnet), **FB-06** (Sonnet), **FB-07** (Opus) and **FB-10** (Sonnet) at the same time: they touch intake, engineering, Quoting and G3, and scoring. Every migration is renumbered on rebase (the prompts say how) | Four draft PRs, `pnpm verify` green |
| 2 | Mon Nov 9 | Ask the people, in one message each | Ben, Bailey | See "What only people can supply" below. Send today: the answer to the Finance role (IT), lists (Jim, Danielle), the workbook and template (Kal, Gemma, Stacy), Paul's engineer pairs | Each has a name and a date |
| 3 | Mon Nov 9 | Azure: test what-if, then apply; load test; IT batch | Ben (PC with `az`) | `03` B-20 and B-21; ask IT for `rg-ccq-prod`, the written prod-data approval, the UAT cohort, the M7 grants and an alert email | What-if and p95 recorded; IT items owned |
| 4 | Mon Nov 9 to Tue Nov 10 | UAT staging; **U2** engineering UAT | Ben, Bailey, Jim's team | Stage the quotes (`docs/uat/README.md`). Run `scripts/engineering.md` on today's build. Record the Fabric tie-out (B-27) | U1 and U2 signed |
| 5 | Tue Nov 10 | **Merge Wave 4a**; start **Wave 4b** | Ben | Merge in this order as each is green: FB-11, FB-06, FB-10, FB-07. Start **FB-09** (Sonnet) when FB-11 merges and **FB-08** (Opus) when FB-07 and FB-11 merge | 4a on `main`; 4b started |
| 6 | Tue Nov 10 to Wed Nov 11 | Prod infrastructure (independent of the app code) | Ben + IT | Bicep apply to prod (what-if first), Key Vault secrets, Postgres restart, Salesforce prod sync and reconciliation, UAT users, alert email and a test alert (`03` B-22) | Prod runs on approved data |
| 7 | Wed Nov 11 | **Merge Wave 4b**; deploy to test | Ben | Merge FB-09 then FB-08. Deploy `main` to test. Run `pnpm verify` and the Playwright suite on the merged build | One green `main` on test |
| 8 | Wed Nov 11 | UAT scripts for FB-06 to FB-11; **U4** security | Claude Code, Bailey, IT security | Update `docs/uat` (scripts, quick-starts, `print.html` and `public/help/quickstart.html` together) for the new screens. Run `security-access.md` | Scripts match the build |
| 9 | Thu Nov 12 | **U3** (pricing, approver, leadership) and **U5** tie-out; defects | Bailey, testers, Zac, Graham, D&A, Ben | Run `pricing.md`, `approver.md`, `leadership.md` and `tie-out.md` on the merged test build. Fix Sev-1 and Sev-2 same day | Sev-1 and Sev-2 clear |
| 10 | Thu Nov 12 (evening) | Deploy to prod; tag and freeze | Ben | Deploy to prod, purge synthetic data, config approval pass (every provisional value listed in `docs/uat/config-snapshot.md`), tag `v0.9.0-uat`, re-run the load test | Prod live on the frozen build |
| 11 | Fri Nov 13 | Gate package; **U6** sign-off | Ben, Bailey | Refresh `docs/gate/` and tick B-24 | Signed UAT: MVP |

**The fallback rule.** If a step's PR is not green by **Wed Nov 11, 2 PM**, it does not go in the freeze: it moves to pilot readiness and its UAT script step is struck. Drop in this order, least to most important: FB-10 (inactive anyway), FB-09, FB-08, the rest of FB-06. FB-11 and FB-07 are the ones Pricing is waiting for.

### What only people can supply, and what ships if they don't

| Step | Needed from | By | If it does not arrive, this ships |
|---|---|---|---|
| FB-06 | **In (inbox, Nov 4):** Paul's engineer pairs (seeded as provisional suggestions) and the link to Kal's blank *Pretium Project Workbook Template.xlsx* (A-030: open it and pick the CSR BOM tab). **Still needed:** Kal's minimum fields; Engineering: pack-out and two-step confirmation (A-014); the estimate workbook (F-026) | Tue | BOM upload (no extraction); a single assignee with the seeded suggestions; two-step and pack-out as optional fields; no field mapping, only questions |
| FB-07 | IT: the Finance app role and group (A-032); Gemma and Stacy: the costing and ROI templates (A-031) | Tue (role), Thu (templates) | Uploads and versions without the one-page summary. Until Entra has the role, the pricing lead uploads the ROI model for Finance |
| FB-08 | Gemma: the exception approver (A-012 closed Nov 9: Net 15 and Net 30 are both standard); Bailey with Oleg and Sarah: the extra approval for customer-funded quotes (A-035); D-002 tiers | Wed | Net 15 and Net 30 standard, the PricingLead approving exceptions, funding to Engineering, the extra approval and tiers present but off |
| FB-09 | Jim: active plants and machine types; Danielle: resin, market and product family lists; Bailey: D-016 and D-006; plant pack-out standards (A-028) | Tue | The 500-character caps, the "Other" rule and the sign-off flow; lists and plants stay provisional (the three placeholder plants remain); a mandatory-fields proposal for Bailey |
| FB-10 | Sales and Marketing leadership: D-004 (weights, points, bands); Danielle: the platform-guide column mapping | Thu | An inactive draft scoring model and the preview; live scoring unchanged; guardrail warnings present but off |
| FB-11 | Nothing. Dunnage wording is provisional (A-033) | | Ships as built |

**Risks to watch.**
1. Six PRs changing migrations, the permission matrix and intake in two days. The merge order above exists to keep conflicts small; each session renumbers its migration on rebase.
2. UAT time for six new features is short (Thu). Expect Sev-2 findings; the fallback rule protects the freeze.
3. IT: the prod resource group and the written prod-data approval are on the critical path for step 6, and the Finance role needs Entra.
4. Provisional values in live use: a person has to sign off each one before the pilot (they are listed in `04` §2a and the config snapshot), but not before Nov 13.
