# 05: Path to MVP: Connect, Validate, Sign Off

**The short version of what's left.** The app is built on synthetic data (B-01 to B-19). What remains is mostly *other people's* work: access grants, real data, business decisions and user feedback. This page lists that work in the order to do it, who to meet, and what each meeting must produce.

- No dates here on purpose. Put them in your own calendar.
- The detail lives in the other files: build steps in `03-build-steps.md`, open decisions in `04-decisions-and-risks.md`, people in `02-schedule-and-meetings.md` §1. Keep updating those; update this page when a step is done (tick its box) or the order changes.

---

## 1. Where we stand

| Area | Status | What it's waiting on |
|---|---|---|
| Core app: intake, G1, engineering queue and review, quoting, Final Review, outcome, hand-off, board/lists, dashboards, notifications, admin console | ✅ **Built and tested on synthetic data** | User feedback and business decisions (all open rules ship as provisional config) |
| Sign-in (Microsoft Entra) | 🟡 Code built; runs in dev mode | IT app registrations, roles and groups |
| Azure hosting (test + prod) | 🔴 **Not started** (no `infra/`, no deploy pipeline) | Hosting approval and resource groups from IT |
| Salesforce read | 🟡 Built against a fake; live code ready | Connected app + read-only user; real field names |
| Pricing app read | 🟡 Built against a fake; both routes (SQL / Fabric) ready | Route choice, view and column names, read access |
| SharePoint attachments | 🟡 Built; stores files locally for now | Site, library and `Sites.Selected` permission |
| Email notifications | 🟡 Built; in-app works, email goes to a fake | Shared mailbox + `Mail.Send` permission |
| Security hardening, prod data load, UAT pack, gate package (B-21 to B-24) | 🔴 Not started | Mostly build work, plus the security review and prod-data approval |

**Bottom line:** nothing a user sees is blocked on code. Every remaining item is blocked on a person, an access grant or a decision. That's why the order below is driven by **lead time**, not by how the app flows.

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
  - [ ] Azure hosting approved (App Service + PostgreSQL + Key Vault + App Insights, test and prod resource groups)
  - [ ] a named IT person who provisions it, and a date
  - [ ] the path to production-data approval, including what to do with the **~205 live Salesforce records in Bailey's prototype** (purge or approve)
  - [ ] agreement in principle on support: "EI builds, IT hosts and supports"
  - [ ] the access pattern: internal only, or phone access without VPN
- **Bring:** the 1-page hosting proposal (`01-architecture.md` §1, §7, §8) and a cost estimate.
- **After:** file or update the IT tickets (`02` §4).

#### Step 2. Entra and Azure working session · *M2*
- **Runbook:** [`06-azure-entra-setup.md`](06-azure-entra-setup.md) has every command, labelled IT / Dev.
- **Who:** Vincent Brown (Entra / app permissions), Tim Webb (IT infra), Alicia Avellaneda-Cruz (IT PM). Optional: Tre.
- **Why now:** sign-in, roles and the test environment all hang off this. It also creates the Graph permissions SharePoint and email need later.
- **Leave the meeting with:**
  - [ ] two app registrations (SPA + API) with the settings in `03` B-04 notes (v2 tokens, `access_as_user` scope, redirect URIs)
  - [ ] the 8 `CCQ.*` app roles and the `SG-CCQ-*` security groups
  - [ ] the test resource group, and Ben's access to it
  - [ ] GitHub → Azure OIDC trust for deployments
  - [ ] the Graph permissions requested (`Sites.Selected`, `Mail.Send` limited to the CCQ mailbox)
- **After (build):** **B-20** (Bicep + deploy pipeline, first deploy to test), then switch sign-in to Entra. From here on, every review uses the test URL.

### Phase 2: Connect real data

Request all four of these as soon as Step 1 is done. They can run in any order; the order below is by importance.

#### Step 3. Salesforce · *M3*
- **Who:** Rachel Dew (Salesforce admin), Zac Cairns (knows the SF objects), Graham Parle (Sales Ops). Optional: Cory McGahan.
- **Why first of the integrations:** every quote starts from a Salesforce opportunity. It's on the "never cut" list, and real opportunities make every later review more convincing.
- **Leave the meeting with:**
  - [ ] a connected app, certificate and **read-only** integration user on the **UAT org** (prod later, after data approval)
  - [ ] the real API names for every custom field (today they're placeholders): ERF number, quote source, the Opportunity Product Specification object and its fields
  - [ ] which field holds the ERF number, and how reliable it is
  - [ ] the source of truth for customer and ship-to: SF Account or ERP (D-18)
  - [ ] which SF stages count as "won" / "lost" (for the stage-mismatch flag)
- **After (build):** fill in `fieldMap.ts`, run the live contract test, switch `SF_MODE=live` in test.

#### Step 4. Pricing application · *M5*
- **Who:** Cory McGahan (IT, pricing-app data), Gemma Cebolla (Sr Dir Pricing) plus the "James" from the PRD, Brennan Paul. Optional: Bailey.
- **Why:** gives Pricing their ERF/BPR context inside the quote. If it slips, the app falls back to typed-in reference numbers, so it's important but not blocking.
- **Leave the meeting with:**
  - [ ] the route: read-only SQL login (A) or a D&A copy in Fabric (B)
  - [ ] the view names and every column needed (most are guesses today), and how a BPR links to an ERF
  - [ ] the real ERF and BPR number formats
  - [ ] Gemma's confirmation of **who may see pricing, margin and capital** (today: Pricing, Eng leads, Approver, Leadership, Admin)
  - [ ] who "James" is
- **After (build):** column map, live contract test, switch `PRICING_MODE`.

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
  - [ ] the post-MVP plan to copy CCQ data into Fabric
- **After (build):** small SQL edits in `packages/db/sql/analytics/`.

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
| **Azure hosting** | Oliver Kade, Tim Webb | Resource groups, OIDC trust | **None.** UAT moves day for day | [ ] app deployed to the test URL |
| **Entra sign-in** | Vincent Brown | 2 app registrations, 8 roles, groups | Dev mode (not valid for UAT) | [ ] real users sign in with the right roles |
| **Salesforce** | Rachel Dew (access), Zac / Graham (fields) | Read-only user on UAT then prod, field API names | **None for MVP** (never cut) | [ ] live test passes; prod sync reconciles to the SF report |
| **Pricing app** | Cory McGahan, Gemma Cebolla | Route, views, columns, formats, read login | Typed-in ERF/BPR references | [ ] live test passes |
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
| **Brennan Paul** (D&A) | 1, 4, 6, 14 | Prod-data approval, data definitions, Fabric |
| **Rachel Dew, Zac Cairns, Graham Parle** (Salesforce) | 3, 6, 14, 16 | SF access, field names, tie-out |
| **Cory McGahan** (IT, pricing data) | 4 | Pricing-app read access and columns |
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
