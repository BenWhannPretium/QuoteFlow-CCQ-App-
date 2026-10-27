# 02: Schedule, Collaborators and Meeting Plan

**Window:** Thu 2026-10-15 → **Fri 2026-11-13 (MVP: UAT-ready on approved data)**. That's 21 working days, so meetings are short, targeted, and booked **before** the build step that needs them. Each meeting has one job: get a decision, an access grant, or acceptance.

> **Send invites today (Oct 15) for M1–M5.** People's calendars are the critical path, not code.

---

## 1. Who you need, and why

| Person | Role (as found in sources) | Why you need them | First touch |
|---|---|---|---|
| **Darren Miller** | Sr Dir, Business Transformation. Build sponsor (DEC-24/25). | Hosting decision, scope calls, escalation, Gate sign-offs | M1 (Oct 16) |
| **Bailey Schmitt** | Sr PM, BT. PRD owner, interim product owner, author of the QuoteFlow concept. | Requirements, stakeholder reviews, UAT, decision package to Sarah | Daily / M4 |
| **Tre Curry** | PM, Enterprise Intelligence. Workflow coordination. | Day-to-day unblocking, Asana REQ-8815, GitHub org | Daily standup |
| **Oliver Kade** | VP IT | Azure hosting approval, support model, exposure pattern, security sign-off (Gates 3–6) | M1, M8, M9 |
| **Chris O'Brien** | Sr Dir IT Operations | Who in IT provisions and supports Azure; runbook owner | M2, M9 |
| **Tim Webb** | IT Manager | Provisioning hands (RG, App Service, Postgres, networking) *[confirm]* | M2 |
| **Alicia Avellaneda-Cruz** | IT Project Manager | Tracks IT tasks/tickets for CCQ | M2, M9 |
| **Vincent Brown** | IT (Entra app permissions; set up the Power BI/Claude connector) *[confirm role]* | Entra app registrations, app roles, security groups, Graph consent | M2 |
| **Raj Sharma** | IT Help Desk | Ticket intake (#131026 dev access, new tickets) | Ticket |
| **Cory McGahan** | IT: pricing-app exports, back-end table access, SF integration user | Pricing DB read access + schema; attachment extraction | M5 |
| **Rachel Dew** | Salesforce admin/owner (set up the read-only SF MCP) | Connected app, read-only integration user, UAT org | M3 |
| **Zac Cairns** | Sr Mgr, BT. Knows the SF objects (Opportunity, Opportunity Product Specification). | SF field crosswalk, ERF↔Opportunity link, Ranger | M3, M6 |
| **Graham Parle** | Sales Ops / Sales Intelligence | SF field mapping, stage usage, reporting needs | M3, M6 |
| **Brennan Paul** | Sr Dir, Data & Analytics | Production-data approval, certified data model, **Fabric data landing (L-8, with Oleg)**: workspace, capacity, Fabric security | M1, M5, M6, MF |
| **Jim Zweifel** | Upfront product engineering lead (NPI/NPD pre-award). Initial owner of the MVP queue. | Validate intake fields and routing; Engineering Review design; UAT | M4, R2 |
| **Danielle Leu** | Director, Product Commercialization (former ERF admin) | Intake fields, stage definitions, ERF link | M4, R1, R2 |
| **Faron Ipox** | Corporate production planning / capacity analyst | Capacity evidence fields (CR-19) | R2 |
| **Jeffrey Pitrak** | Supply chain / capacity | Capacity gate rule (interim one-pager) | R2 |
| **Paul Slomkowski** | VP Ops Engineering. Final Review candidate. | Ops-engineering BOM / capital fields; approver candidate | R2 (optional), R3 |
| **Gemma Cebolla** | Sr Director, Pricing | Pricing gate, sensitivity labels, pricing-app connector scope | M5, R3 |
| **"James" (Pricing)** | Named in PRD F-11 "[Confirm with James / Pricing]" | Confirm who this is (could be Kyle Arnold or a pricing analyst) | via Gemma |
| **Jennifer Solomon** | Director, Finance Cost-to-Serve | Costing checkpoint (stays in Excel for MVP) | R3 |
| **Jack Gordon / Matt Graden** | SVP Sales / sales leader | G1 qualification owner (interim), Final Review candidate | M4, R3 |
| **Jordan Albin** (+ 1–2 KAMs, e.g. Linda Vinegar, Josh Edmonson) | KAMs, the end-user voice | Intake usability; UAT | R1, UAT |
| **Sarah Brennan** | CCO, Executive Champion | Final Review approver, outcome taxonomy (via Bailey's decision package) | Async via Bailey |
| **Oleg Yarovinski** | VP Business Optimization, Capital Mgmt. CCQ sponsor. | Stage-model sign-off (D-03), CER link, Fabric data landing (L-8, with Brennan; D-FB1) | Async via Bailey; MF (optional) |
| **Nicole Donnelly, Anne DeSmet** | NPI Project Engineers (post-award) | P2 hand-off view; optional UAT viewer | R3 (optional) |
| **Amanda Cronkhite** | Commercial Activation (owns post-award hand-off from 10/26) | Awarded hand-off record fields | R3 (optional) |

---

## 2. Meeting plan (dates are targets; book them now)

Legend:
- **Org** = who sends the invite.
- **Blocks** = the build steps that stall if the meeting slips.

### Week 0: Oct 15–16

| # | When | Length | Org | Attendees | Purpose and decisions needed | Pre-read | Blocks |
|---|---|---|---|---|---|---|---|
| — | **Thu Oct 15, 3:00 PM** (existing Weekly PMO) | 5 min slot | Darren | PMO group | Present the "prototype → PRD → knowledge share → build in 8 business hours" practice (Darren's ask). Announce the Azure hosting proposal and that M1 is booked. | — | — |
| **M1** | **Fri Oct 16** (or Mon Oct 19 AM at the latest) | 45 min | **Ben** | Darren, Oliver Kade, Brennan Paul, Tre; optional Chris O'Brien | **Gate 2 platform decision.** (1) Approve Azure hosting (App Service + PostgreSQL Flexible + Key Vault + App Insights) in `rg-ccq-test` / `rg-ccq-prod`. (2) Name IT's provisioning owner and set a **date ≤ Wed Oct 21**. (3) Support model owner (D-17): agree "EI builds, IT hosts/supports" in principle. (4) **Production-data approval path** (D-23), including the 205 live SF records already in Bailey's prototype. (5) Exposure pattern: phone without VPN vs internal-only (D-H2). | 1-page hosting proposal (from `01-architecture.md` §1, §7, §8) + cost estimate | B-04, B-06 (prod), B-20, everything after Oct 23 |

### Week 1: Oct 19–23 (foundations + intake)

| # | When | Length | Org | Attendees | Purpose and decisions needed | Pre-read | Blocks |
|---|---|---|---|---|---|---|---|
| **M2** | **Mon Oct 19, AM** | 45 min | Ben | Vincent Brown (or IT identity owner), Tim Webb / IT infra, Alicia Avellaneda-Cruz; Tre | **Entra + Azure working session.** Create the SPA and API app registrations; define the 8 app roles (B-26 later added a ninth, `CCQ.PricingLead`); create the `SG-CCQ-*` groups; Graph application permissions (`Sites.Selected`, `Mail.Send` with an application access policy); GitHub OIDC federated credential; Bicep review; RG ownership. File tickets during the meeting. | Role table (`01-architecture.md` §3.1), `infra/` Bicep draft | B-04, B-20 |
| **M3** | **Mon Oct 19, PM** | 45 min | Ben | Rachel Dew, Zac Cairns, Graham Parle; optional Cory McGahan | **Salesforce read integration.** (1) Connected app + JWT cert + **read-only integration user** (UAT org first, then prod). (2) Objects and fields: Opportunity (Id, Name, AccountId, OwnerId, Amount, CloseDate, StageName, SystemModstamp, **ERF number**, **quote source**), Account (+ ship-to/billing address), Opportunity Product Specification fields. (3) Which SF field holds the ERF number and how reliable it is. (4) **Authoritative customer + ship-to source** (blueprint gap, D-18): SF Account vs ERP customer master. | Field list draft + "New Last Week" report | B-06, B-07 |
| **M4** | **Tue Oct 20, 10:30 AM** (after Silver training) | 60 min | Bailey (Ben co-runs) | Jim Zweifel, Danielle Leu, one sales leader (Matt Graden or Jack Gordon's delegate), Jordan Albin | **Intake + routing validation (DP-06; Op Model action A-04).** Decide: (1) minimum intake field set, **including neck finish/type and packaging**; (2) "stop vs enrich", i.e. which missing fields block G1; (3) interim **G1 decider** (sales leader?); (4) which **scoring attribute set** to show (PRD 7 vs prototype 7, X-89) and that MVP scores are *advisory*; (5) min value/volume screens as **warnings**, with which numbers (3M IBM vs 300k resin, X-48); (6) engineer chosen in Eng Review, not intake (X-90). Show the B-07 wizard skeleton on synthetic data. | Wizard click-through, field table | B-07, B-08 |
| **M5** | **Wed Oct 21, AM** | 45 min | Ben | Cory McGahan, Gemma Cebolla (+ the "James" from F-11), Brennan Paul, Bailey | **Pricing app read path + sensitivity.** (1) Route A (read-only SQL login to a replica/views) vs B (D&A copy in Fabric); (2) tables/columns needed (ERF, BPR; SPR history); (3) who may see pricing/margin (confirm the role list in §3.3 of the architecture doc); (4) sensitivity labels; (5) attachment extraction date (no firm date as of 10/13). | ERF/BPR columns needed list | B-15 |
| **⚑** | **Wed Oct 21, EOD** | — | Darren / Oliver | — | **AZURE GO/NO-GO.** No test resource group by EOD Oct 21 → escalate to Darren the same day. There's no CMR fallback by design, so **every day of slip moves UAT**. | — | — |
| **M6** | **Thu Oct 22** | 30 min | Ben | Brennan Paul (or a D&A analyst), Zac Cairns, Graham Parle | **MVP data dictionary (CR-47, M4 milestone).** Agree definitions for every MVP field (owner, source, allowed values). Agree the post-MVP plan to mirror CCQ into Fabric for certified analytics. Confirm MVP dashboards are labelled "operational, not certified". | Generated dictionary from the DB schema | B-17 |
| **R1** | **Fri Oct 23** | 45 min | Bailey | Jordan Albin + 1–2 KAMs, sales leader, Danielle Leu; Tre | **Stakeholder review #1: Intake** (workflow-ordered reviews per the 10/14 sync). Live demo on the test env (or local if Azure isn't ready). Capture changes into the backlog. | 2-min Loom of intake | B-07/B-08 polish |
| **D-pack** | **By Fri Oct 23** | async | Bailey (+ Oleg) | Sarah Brennan, Darren | Decision package. Must-haves for the build: **Final Review approver** (D-10), **outcome taxonomy + reason codes + closure owner** (D-15), **validity days** default (D-12), **KAM peer-score visibility** (open question). Needed by **Wed Oct 28**. | Op Model §16 | B-12, B-13 |

### Week 2: Oct 26–30 (workflow stages)

| # | When | Length | Org | Attendees | Purpose and decisions needed | Pre-read | Blocks |
|---|---|---|---|---|---|---|---|
| **M7** | **Tue Oct 27** | 30 min | Ben | SharePoint/M365 admin (IT), Bailey (folder restructure for Ranger), Tre | **Attachments + mail.** Grant `Sites.Selected` on the target site; agree the `/CCQ/{quote_number}/` folder convention vs the ERF restructure; shared mailbox `ccq-noreply@` + application access policy. | — | B-16, B-18 |
| **⚑** | **Wed Oct 28** | — | Bailey | — | **Decision deadline:** D-10, D-12, D-15 loaded as config (otherwise ship with provisional seeds, flagged). | — | B-12, B-13 |
| **R2** | **Thu Oct 29** | 60 min | Bailey | Jim Zweifel, Faron Ipox, Jeffrey Pitrak, Danielle Leu; optional Paul Slomkowski | **Stakeholder review #2: Engineering Review.** Queue, assign/return, Eng Review fields, **capacity evidence** fields and G2 outcomes (Proceed / Proceed with risk / Capital required / Stop) from the 9/15 interim one-pager. Confirm the alert to Jim (P0) and who backs Jim up as assigner (R-04). | Queue + review demo | B-10 polish |
| **MF** | **Tue Oct 27 or Wed Oct 28** | 45 min | Ben | Brennan Paul (+ the D&A engineer who'll own the workspace), Oliver Kade or Tim Webb (IT); optional Oleg Yarovinski | **Fabric data landing (L-8).** Decide D-FB1 to D-FB5: (1) a continuous copy by mirroring is enough, Postgres stays the app's store; (2) which tables (SF snapshot, pricing history?); (3) test Postgres Burstable → General Purpose (cost); (4) workspace per env, running F-SKU capacity, item owner = D&A service principal, tenant settings, who may read commercial columns, latency target; (5) is a running prod mirror part of the Nov 13 bar. IT: server restart window, VNet data gateway subnet for prod. | `01-architecture.md` §6.1 + B-27 prompt | B-27, B-22 |
| **M8** | **Fri Oct 30** | 45 min | Ben | Oliver Kade (or IT security delegate), Chris O'Brien; Tre | **Security + access review → Gate 3 design sign-off input.** Threat model, permission matrix + automated tests, RLS, audit, secrets, exposure pattern, pen-test-lite plan for UAT week. | `01-architecture.md` + test report | B-21, Gate 3 |

### Week 3: Nov 2–6 (integrations, insight, hardening)

| # | When | Length | Org | Attendees | Purpose and decisions needed | Pre-read | Blocks |
|---|---|---|---|---|---|---|---|
| **M9** | **Mon Nov 2** | 45 min | Ben | Oliver Kade, Chris O'Brien, Tim Webb, Alicia; Darren | **Support model + go-live readiness (D-17, Gate 6 prep).** Who's on call; runbook; prod deploy approvals; backup/restore; hypercare window. **Confirm production-data approval** for the UAT load (Nov 6). | Runbook draft | B-22, B-24 |
| — | **Mon Nov 2** | 15 min | Bailey | Bailey, Ben | Confirm the **UAT cohort** (names per role) and UAT schedule; their Entra group membership requests go to IT the same day. | — | B-23 |
| **R3** | **Thu Nov 5** | 60 min | Bailey | Gemma Cebolla + pricing analyst, Jennifer Solomon, Final Review approver(s), Matt Graden; optional Amanda Cronkhite, Nicole/Anne | **Stakeholder review #3: Quoting, Final Review, Outcome, Hand-off.** Price-approval record, capital readiness, G4 approve/decline, outcome + reason codes, validity, minimal hand-off record. | Demo | B-11–B-13 polish |
| **⚑** | **Fri Nov 6, 5 PM** | — | Ben | — | **Feature freeze.** Production SF + pricing data loaded into prod (only if approved). | — | — |

### Week 4: Nov 9–13 (UAT and sign-off)

| # | When | Length | Org | Attendees | Purpose |
|---|---|---|---|---|---|
| **U0** | Mon Nov 9, 9:00 | 45 min | Bailey | All UAT testers | UAT kickoff: how to test, how to log defects (in-app feedback button), schedule |
| **U1** | Mon Nov 9 | 2 h | Bailey | KAMs + sales leader | UAT: intake, G1, outcome |
| **U2** | Tue Nov 10 | 2 h | Bailey | Jim's team, Faron | UAT: queue, Eng Review, capacity evidence, G2 |
| **U3** | Wed Nov 11 | 2 h | Bailey | Pricing, approver, leadership | UAT: quoting, G4, dashboards, override log |
| **U4** | Wed Nov 11 | 60 min | Ben | IT security delegate | Security / access test (Gate 5 component) |
| **U5** | Thu Nov 12 | 45 min | Ben | Zac, Graham, D&A | **Tie-out**: CCQ ↔ Salesforce ↔ pricing-app spot checks (Gate 5 requirement), plus **CCQ ↔ Fabric** row counts and sample quotes (B-27) |
| **U6** | **Fri Nov 13, 10:00** | 45 min | Bailey | Darren, Bailey, Tre, Ben, gate-owner candidates (Jim, Gemma, approver), Oliver/IT | **UAT sign-off → Gate 4/5 package. MVP done.** |

### Recurring

- **Daily, 9:00, 15 min:** Ben + Tre standup. Blockers, tickets, today's step.
- **Weekly, Thursday, 45 min:** CCQ Design & Delivery. Fold into the existing *CCQ Web App Requirements Sync* (Op Model §8; no net-new meeting). Attendees: Bailey (chair), Tre, Ben, Zac; others as needed.
- **Weekly, Thursday, 3–4 PM:** Business Transformation PMO. One status line: on track / at risk, blockers, the ask.

---

## 3. Day-by-day build calendar

| Day | Build steps (see `03-build-steps.md`) | Meetings / deadlines |
|---|---|---|
| Thu Oct 15 | **B-00** repo + CLAUDE.md + this guide; send M1–M5 invites; file IT tickets | PMO 3 PM |
| Fri Oct 16 | **B-01** monorepo scaffold, CI; start **B-02** | **M1** hosting |
| Mon Oct 19 | **B-02** domain engine; **B-03** schema + seeds | **M2** Entra/Azure, **M3** Salesforce |
| Tue Oct 20 | **B-04** auth + RBAC (dev mode first, Entra when app regs exist) | **M4** intake validation |
| Wed Oct 21 | **B-05** shell + design system; **B-20** Bicep ready | **M5** pricing; ⚑ Azure go/no-go |
| Thu Oct 22 | **B-06** Salesforce reader (fake → UAT org) | **M6** data dictionary |
| Fri Oct 23 | **B-07** intake wizard; **B-20** first deploy to test | **R1** intake review; D-pack out |
| Mon Oct 26 | **B-08** scoring + G1 | — |
| Tue Oct 27 | **B-09** overrides, timeline, audit | **M7** SharePoint/mail |
| Wed Oct 28 | **B-10** engineering queue + review (part 1) | ⚑ D-10/D-12/D-15 |
| Thu Oct 29 | **B-10** (part 2: capacity evidence, G2, alerts) | **R2** engineering review |
| Fri Oct 30 | **B-11** quoting; **B-12** Final Review | **M8** security → Gate 3 |
| Mon Nov 2 | **B-13** outcome, validity, hand-off | **M9** support; UAT cohort |
| Tue Nov 3 | **B-14** board, lists, approvals, export | — |
| Wed Nov 4 | **B-15** pricing reader; **B-16** attachments | — |
| Thu Nov 5 | **B-17** dashboards; **B-18** notifications | **R3** quoting/final review |
| Fri Nov 6 | **B-19** admin config; **B-21** hardening; **B-22** prod data load | ⚑ feature freeze |
| Mon Nov 9 | **B-23** UAT support + fixes | U0, U1 |
| Tue Nov 10 | UAT fixes | U2 |
| Wed Nov 11 | UAT fixes | U3, U4 |
| Thu Nov 12 | Regression, tie-out, **B-24** Gate package | U5 |
| **Fri Nov 13** | Release to prod for pilot readiness | **U6 sign-off** |

**Cut lines if behind** (in this order, agreed in advance with Darren):
1. B-19 admin UI → manage config by seed scripts + SQL migrations.
2. B-17 analytics → keep only time-in-stage + pipeline by stage.
3. B-15 pricing reader → manual ERF/BPR reference fields (format-validated).
4. B-16 SharePoint → store attachments in Azure Blob behind the same interface.
5. B-18 email → in-app notifications only.

**Never cut:** SSO/RBAC, audit, stage engine, intake, queue, gate decision records, outcome + reason codes, Salesforce read.

---

## 4. IT tickets to file today (Oct 15)

Raise them via Raj Sharma / the help desk. CC Oliver Kade, Tre, Darren.

1. **Azure subscription/resource groups** `rg-ccq-test`, `rg-ccq-prod`, with Contributor for the CCQ build identity (Ben) on **test**. Prod stays IT-deployed or approval-gated. (Supersedes the broad ask in #131026; the scope is narrower.)
2. **Entra app registrations** `QuoteFlow-SPA`, `QuoteFlow-API`; 8 app roles and 8 security groups (`SG-CCQ-*`), plus `CCQ.PricingLead` / `SG-CCQ-PricingLead` from B-26; admin consent for Graph application permissions `Sites.Selected` and `Mail.Send`, the latter restricted by an application access policy to `ccq-noreply@`.
3. **Shared mailbox** `ccq-noreply@pretiumpkg.com`.
4. **Developer workstation**: Node 22, pnpm, Docker Desktop (or WSL2 + Docker), Git, Azure CLI, Bicep. Terminal policy exception for Claude Code (from #131026).
5. **GitHub**: Pretium organization (or confirm the existing one) and transfer this repo; GitHub Actions enabled; OIDC trust with Azure.
6. **Salesforce** (to Rachel Dew): connected app + read-only integration user + permission set on the **UAT org**, then prod.
7. **Pricing DB** (to Cory McGahan): read-only login to ERF/BPR views (or the Fabric copy). Depends on M5.
