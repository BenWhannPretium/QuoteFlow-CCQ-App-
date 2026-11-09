# FB-08 · Commercial terms and Final Review

**Run with:** Claude Code · **Opus 5.5 · high effort** · Wave 4b, **ready after FB-07 and FB-11 merge** · one draft PR
**Tracker items:** F-021, F-068, F-082 · tests T-007, T-031 · **Gated on:** D-003 (who owns MOQ, tooling funding and payment terms; standard term Net 15 vs Net 30; exception approver), D-029 (milestone payment terms), A-012 (Gemma Cebolla). D-002 (Final Review tiers) is optional: if it is undecided, build terms and leave the tier hook off. **Moved to FB-11 (2026-11-09):** the customer's requested payment terms and the funding question at intake (D-032). **F-082** (extra Final Review approval for customer-funded quotes) needs Oleg's and Sarah's confirmation first (A-035).

**Paste into Claude Code from the repo root.**

---

## Stop check: none (changed 2026-11-09: build now with provisional defaults)
Ben wants every FB step built this week. **Start after FB-07 and FB-11 have merged** (they change G3, the attachments, the permission matrix and the intake terms fields); `git fetch origin main` first. Read `04` §2a and the tracker rows for D-002, D-003, D-029, A-012, A-035 and D-032, then use these **defaults** (record each as provisional in the PR):

- **Standard payment terms:** Net 15 and Net 30 (FB-11's `standard_payment_terms`); anything else is non-standard and creates a **terms exception request**, routed to the PricingLead (D-003's recommendation: Gemma or her designee), who approves or rejects with a rationale. G4 cannot approve while an exception is pending (`terms_exception` in `g4_required_checks`).
- **MOQ and tooling funding to Engineering** (D-003's recommendation): add `terms.engineering.edit` for EngLead and Engineer on those fields. The KAM can still pre-fill the funding at intake (FB-11).
- **Milestone options (D-029, Gemma, Nov 6):** upfront; 50/50 (at the order and at qualification); amortized into the per-piece price; plus a short note (≤ 300). No quarterly.
- **F-068 capital terms at Final Review:** as specified below. Seed `terms_finalized` in `g4_required_checks` (it is the approver's own field, so it does not repeat the F-069 problem). Provisional.
- **F-082 and the D-002 tiers:** build the hook (`g4_additional_approvals`, `g4_tier_rules`) and seed them **off**, with the proposal (customer-funded or $0 CER: sales leader, then leadership) as a disabled provisional rule. Do not enable anything: A-035 and D-002 are open.

Rule 4 (CLAUDE.md) lets you build a mechanism with **provisional config** while a business decision is open, and an Admin sets the final value later without a release. That is what this step does. Nothing below is a reason to stop. If something you need is genuinely missing (a file, a list), say so in the PR, keep the item's config provisional or inactive, and build the rest.

## Ground rules for this step
- **Start from the latest `main`.** Read `CLAUDE.md` (non-negotiable rules 1–11), `docs/build-guide/03-build-steps.md` → "User feedback updates" (this step, the readiness table and the change-log procedure), and `docs/build-guide/04-decisions-and-risks.md` §2a.
- **The Feedback Tracker is the source of what was asked.** It is `QuoteFlow Feedback Tracker.xlsx` in SharePoint: `PMO › General › Projects › FY26 - Commercial Capital Quoting › 3. Design › Quote Flow`. If the Microsoft 365 connector is available, read the Build Backlog rows for this step's F- IDs and their linked T-/V-/D- rows before you build. If a row's acceptance criteria differ from this prompt, follow the tracker and record the difference as a deviation. If the connector isn't available, this prompt carries the acceptance criteria as of 2026-11-05.
- **Authorization on the server.** Every changed or new route declares its permission through `packages/domain/src/policy`. Add permission-matrix tests that check **allowed and denied for every role** (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin). Keep `docs/security/route-inventory.md` current (its test fails otherwise).
- **No hard-coded open rules.** Lists, thresholds, messages, required-field sets and formula bases go in config tables or settings, seeded `provisional: true`. Change config in existing environments with a data migration, not by editing seeds alone.
- **Audit everything** a user changes (append-only `audit_event`). Never update or delete audit rows.
- **Fabric-safe schema (rule 10).**
  - New `jsonb` or array column → a `<column>_json text` companion registered in `packages/db/src/fabric.ts`, with its trigger argument and a backfill.
  - Every `numeric` has precision ≤ 38.
  - No partitioning, no `TRUNCATE`.
  - Deprecate columns; don't drop them.
- **Migrations.** Use the next free number in `packages/db/migrations/`. Before you open the PR, `git fetch origin main`. If a new migration has landed there, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. Other FB steps run in parallel and will also add migrations.
- **Tests come with the feature:** domain rules → Vitest unit tests; routes → permission-matrix and integration tests (real Postgres); UI → at least one Playwright happy path for the changed stage.
- **Before opening the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, say so in the PR body and let CI run the integration tests. Fix every failure. Never skip or weaken a test to get green.
- Conventional Commits (`feat(intake): …`), a draft PR, and the repo's PR template.

## Context
- **Today:**
  - The terms live on the quote's Commercial panel, edited by `terms.edit` (KAM own, SalesLeader, Pricing, PricingLead).
  - Payment terms and MOQ are free text.
  - Funding is a value list: Company, Customer, $0 CER, Amortized, plus "Shared" from FB-04.
  - FB-01 made the terms check optional at G4 (`g4_required_checks`) and locked terms after G4 approval.
  - B-12 built a disabled tier hook (`g4_tier_rules = null`).
- **Sales leadership (Matthew Graden, Jennifer Wulf):** the KAM pre-fills funding if known, and the approver finalizes the capital terms at Final Review: funding model, mold ownership, amortization, minimum supply / shortfall, agreement in place (Y/N) and duration (V-054, V-055).
- **Gemma (Nov 4):** terms may follow invoicing milestones, e.g. 50 % down and 50 % at qualification (V-068).

## Update 2026-11-09 (read before building)
- **Intake already captures** the customer's requested payment terms and whether the customer funds capital (FB-11, D-032). Reuse those fields; don't add them again. This step owns who approves exceptions, the standard term and what is finalized at Final Review.
- **Tooling payment options (D-029, Nov 6, Gemma):** upfront, 50/50 (at the order and at qualification) or amortized into the per-piece price. **No quarterly.** Use these as the milestone list if D-029 is decided as recommended.
- **F-082 (only after A-035):** when the funding model is customer-funded or $0 CER, Final Review also needs a leadership sign-off **after** the sales leader's. Gemma: leadership decides whether the business takes it, not Pricing (the price is already approved). Oleg: not settled on Nov 9. Build it as provisional config: `g4_additional_approvals`, an ordered list of role sign-offs with a trigger (`funding_model` in a configured set), seeded **off** with the proposal as a disabled provisional rule. If A-035 is not in, do not enable it.

## Build, by decision outcome
- **F-021 ownership:**
  - Move MOQ and tooling funding to whoever D-003 names: if Engineering, add a `terms.engineering.edit` permission for EngLead and Engineer on those fields only.
  - Make **payment terms** a value list (e.g. Net 15, Net 30, Other; the standard term from D-003).
  - Anything other than the standard term auto-sets `terms_nonstandard`. Under D-029, add a short milestone note (≤ 300) and, if decided, structured milestones: percent, trigger, sum = 100 %.
- **Exception approval (T-007):**
  - A non-standard term creates a **terms exception request** routed to the PricingLead or the named designee.
  - They approve or reject with a required rationale. The decision is audited and notified through FB-05's resolver.
  - G4 can't approve while an exception is pending: add `terms_exception` to `g4_required_checks`.
- **F-068 capital terms at Final Review:**
  - Add the fields to the terms model: funding model, mold ownership, amortization (Y/N + months), minimum supply / shortfall terms (≤ 300), agreement in place (Y/N), agreement duration (months).
  - The KAM may pre-fill them at intake or on the quote. The **approver** edits and confirms them on the Final Review screen (new permission `terms.finalize`, Approver only).
  - They are **required and then locked** at G4 Approve (T-031).
  - Put `terms_finalized` in `g4_required_checks` by data migration, once D-003 says the approver owns it.
- **D-002 tiers** (only if decided): enable `g4_tier_rules` with the decided thresholds (by capital or revenue). It routes the G4 decision to the named approver groups. The thresholds live in config, provisional until signed off. Add Entra groups and the `06` runbook if new approver groups appear.

## Acceptance
- [ ] tracker acceptance criteria for F-021 and F-068 pass (T-007, T-031); F-082 and tiers only if A-035 / D-002 are decided
- [ ] permission-matrix tests for every new permission (allowed and denied per role); route inventory current
- [ ] `pnpm verify` passes; close-out done

## Close-out: update the build docs and the change log (do this last)
1. **Build docs (same PR):**
   - In `docs/build-guide/03-build-steps.md` → "User feedback updates", tick this step's boxes. Add **"Built <YYYY-MM-DD>. Notes and deviations:"** listing anything built differently from this prompt or the tracker, every provisional value you seeded, and anything left for later.
   - Update `04-decisions-and-risks.md` §2a if you relied on a decision or seeded a provisional value for an open one.
   - Update the "User feedback updates" row in `05-path-to-mvp.md` §1.
   - Update `01-architecture.md` (workflow §4, permissions §3.4, notifications §4.3, data model §5) where you changed them.
   - Run `pnpm db:dictionary` if the schema changed.
2. **Repo change log (same PR):** in `docs/build-guide/feedback-change-log.md`, add one row per tracker item this step addressed, with these columns:
   - **Date** (today, US Central)
   - **Type** `Build change`
   - **Step** (this FB number)
   - **Change**: what was built, in words a KAM or engineer understands
   - **Feedback IDs**: the F- item plus the T-/V-/D-/Q- rows it closes or follows
   - **Raised by**: names and function, from the tracker
   - **Rationale**: the full reason for the change. Cover the feedback and who raised it, the decision it follows, why it was built this way, what was deliberately not done, and any provisional value awaiting sign-off.
   - **Status** `In PR`
   - **PR / commit**: the PR link once it exists
   
   Then change any earlier rows whose PRs have merged to `Merged`.
3. **Tracker Change Log (after the PR is open):** append the same rows to `QuoteFlow Change Log.csv` in the same SharePoint folder as the Feedback Tracker. Use the Microsoft 365 connector:
   1. `sharepoint_search` with query "QuoteFlow Change Log.csv".
   2. `read_resource` to read it.
   3. Append your rows as RFC 4180 CSV, quoting any field with a comma, quote or line break.
   4. `sharepoint_update_file` with the full text.
   
   Also update the Status of earlier rows that have merged. If the file is missing, create it with `sharepoint_upload_file` in the Quote Flow folder (the parent of the tracker), with the header `Date,Type,Step,Change,Feedback IDs,Raised by,Rationale,Status,PR`. **Never upload, replace or edit `QuoteFlow Feedback Tracker.xlsx` itself.** If the connector isn't available or the write fails, end your final reply with the rows as tab-separated lines under the heading "Paste into the tracker's Change Log tab".
4. **Final reply:** what was built, any deviations, the provisional values awaiting sign-off, which T- scenarios are now ready to test, and the PR link.
