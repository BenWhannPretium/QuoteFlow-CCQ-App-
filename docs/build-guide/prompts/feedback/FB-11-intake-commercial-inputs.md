# FB-11 · Intake commercial inputs: payment terms, customer funding, dunnage, delivery and freight, bid reference

**Run with:** Claude Code · **Sonnet 5.5 · high effort** · Wave 3, **ready (added 2026-11-09)** · one draft PR
**Tracker items:** F-080, F-063 (dunnage only), F-085 · decision D-032 (decided Nov 6, Standard Pricing Options session: Bailey Schmitt, Gemma Cebolla, Kyle Arnold, Cait Catanzaro, Ben Whann) · **Not gated:** nothing is waiting on an input. The mandatory-field list (D-006) and the standard payment term (A-012) are open, so build the fields **optional** and the standard set as **provisional** config.

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Read the **Decision record** below. If the Microsoft 365 connector is available, read the tracker's Decision Log row D-032 and the Build Backlog rows F-080, F-063 and F-085. If their acceptance criteria differ from this prompt, follow the tracker and record the difference as a deviation.
2. Do not make any new field required at submit (D-006 is open; CLAUDE.md rule 4). A missing value is a warning.

**Decision record:**
```
D-032: at intake the KAM captures (1) the payment terms the customer requests, flagged if non-standard; (2) whether the customer funds any of the tooling or capital (not the amount); (3) a checkbox for returnable (multi-trip) dunnage, otherwise single-trip; (4) delivered or FOB price and, when delivered, the freight type (flatbed, van, drop trailer, T-bar) and any special arrangement. Payment terms and tooling funding are two separate things. Decided by Gemma Cebolla and Bailey Schmitt on 2026-11-06. Pricing does not need the payment terms to cost; it needs them for awareness and negotiation.
Transcript: Teams "CCQ | QuoteFlow Standard Pricing Options", 2026-11-06 (Ben has it).
```

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
- **Why:** on Sam's, returnable dunnage, freight and safety stock were not in the costing and surfaced after award. "When anybody says drop trailer, I started screaming" (Gemma): a drop trailer sits for two weeks and, if it was not quoted, "you're bleeding a lot of money". T-bars are rare but very expensive.
- **Payment terms (Gemma):** the standard is ideally Net 30 or Net 15. A longer request (Net 60, Net 120) is a negotiation lever because Pretium carries the borrowing cost, so the quote team must be aware of it. It does not change the costing.
- **Funding (Gemma):** intake only needs to know **whether** the customer pays for part of the tooling. The amount and the payment method (upfront, 50/50, per piece) belong to the terms later (FB-08). If the customer owns the tool it is not Pretium capital, and sales-tax and contract terms apply (Tax). Show that as a one-line hint to the KAM; do not calculate anything.
- **Dunnage:** "multi-trip" packaging comes back; "single-trip" goes out and the customer is charged. Pretium has no standard wording yet (A-033), so the label and help are provisional.
- **Today:** the Commercial panel (after intake) holds free-text payment terms and the funding list (Company, Customer, $0 CER, Amortized, Shared). Intake has packaging type and notes only. Cait Catanzaro confirmed nothing else is missing for costing.

## Build
Use the same patterns as FB-02 (`apps/web/src/intake/Steps.tsx`, `packages/contracts/src/intake.ts`, the required-field setting, value lists in config, `FIELD_META` labels and help). All new fields are **nullable**, optional at submit and shown with a one-line "why we ask".

- **Requested payment terms (F-080).** A value list `requested_payment_terms` (Net 15, Net 30, Net 45, Net 60, Net 90, Net 120, Other with a short description), provisional. A setting `standard_payment_terms` (seeded `["NET_15","NET_30"]`, provisional) decides the non-standard flag: anything else shows "Non-standard: Pricing will review" on the intake and the quote. Store the answer on the quote's intake data, not on the terms record (FB-08 reconciles them). Show it read-only on the Commercial panel as "Customer requested".
- **Customer funding (F-080).** Add the existing `tooling_funding_model` list to intake step 3 with one more value, **"Not discussed"** (provisional), default "Not discussed". It writes the same funding field the Commercial panel edits (the KAM may pre-fill it, V-054/V-055). When the answer is Customer, Shared, $0 CER or Amortized, show the sales-tax hint. FB-04's ⓘ popover already explains the options: reuse it.
- **Returnable dunnage (F-063, dunnage only).** A checkbox "Customer wants returnable (multi-trip) dunnage" (boolean, default false). Help text per A-033, provisional. **Do not add safety stock or a stocking program**: Gemma did not confirm them.
- **Delivery and freight (F-080).** `price_basis` list: FOB Pretium plant / Delivered (provisional). When Delivered: `freight_type` list (Flatbed, Van, Drop trailer, T-bar, Other) and `freight_special_arrangements` short text (≤ 200). The special-arrangements hint names drop trailers and T-bars as costly. Cleared when the price basis changes to FOB.
- **Bid / program reference (F-085).** An optional short text (≤ 60) on intake. Search and the pipeline list find it; Engineering, Pricing and Final Review show it. It is a plain reference: it does not link quotes, and it does not relax the one-active-quote-per-opportunity rule (multi-item bids are F-084, P1).
- **Visibility.** Every role that can read the quote sees these values (CLAUDE.md rule 2). Show them on the Quoting tab under "From intake" and on the Final Review screen. Add them to the pipeline CSV export columns list as optional columns.
- **Schema.** Text, boolean and short-text columns only (no `jsonb`, arrays or unbounded `numeric`, rule 10). New list keys and settings go through a data migration for existing environments, marked provisional. Add the columns to the data dictionary (`pnpm db:dictionary`).
- **Audit and drafts.** Draft autosave and the submit audit include the new fields. Existing drafts and quotes keep working with the fields empty.

## Acceptance
- [ ] tracker acceptance criteria for F-080, F-063 (dunnage) and F-085 pass
- [ ] each new field is optional at submit; a missing one is a warning; the non-standard payment terms flag works from the setting
- [ ] values show to Pricing (Quoting tab) and at Final Review; no route or permission changes beyond the existing intake and quote routes (matrix tests unchanged and green)
- [ ] domain unit tests for the non-standard flag and the freight clearing; Playwright extends `intake.spec.ts` (fill the fields, submit, see them on the Quoting tab) and the 390 px intake
- [ ] the KAM and pricing UAT scripts and quick-starts updated (`docs/uat`, and `print.html` / `apps/web/public/help/quickstart.html` together)
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
