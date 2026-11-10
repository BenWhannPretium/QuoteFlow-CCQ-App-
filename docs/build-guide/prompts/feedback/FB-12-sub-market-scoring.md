# FB-12 · Sub-market at intake, the new market list, and the draft scoring model by sub-market

**Run with:** Claude Code · **Sonnet 5.5 · high effort** · Wave 4b, **ready now** (FB-10 merged as #65) · one draft PR
**Tracker items:** F-073 (strategic-fit points), F-020 (the market list) · tests T-036 · decision **D-004** (Melanie Rasche answered segment vs market and the points on 2026-11-09; Jessica Ransburg and Seamus Keith may still weigh in, and the weights and tier bands are still open) · inputs A-009 (9-box)
**Deadline: green by Wed 2026-11-11, 2:00 PM US Central.** If CI is not green by then, leave the PR as a draft and say so. **FB-10 then ships as it is** (its inactive draft keyed by market), and this merges after UAT. So build in the priority order under "Build", and keep the PR mergeable at each stage.

**Paste into Claude Code from the repo root.**

---

## What was decided, and what this step does
Melanie Rasche (Director of Market Development, Food & Beverage) replied on 2026-11-09 to both of Ben's emails. Her answers are in **`docs/build-guide/feedback/inputs/markets.md`**. Read it first. It is the source for every code, label and point below.

- **Score strategic fit by sub-market** ("sub-market", not "segment": use her word in every label, column and message). She supports adding a sub-market field to QuoteFlow.
- **Points by 9-box colour:** Strategic Growth (green) **80**, Selectively Participate (yellow and gray) **50**, Rationalization (red and pink) **20**.
- **A new market list:** 8 markets with 30 sub-markets.

This step:
1. replaces the market list,
2. adds a sub-market field at intake, and
3. re-keys the **inactive** v3 draft scoring model (FB-10) from market to sub-market at 80 / 50 / 20.

**Nothing about live scoring changes.** The live model stays v2, whose strategic fit is the neutral 50 for every quote. Activating the draft stays a separate, audited Admin action once D-004 settles the weights and tiers (FB-10). The market list and the sub-market field **are** live at intake once merged.

## Ground rules for this step
- **Start from the latest `main`.** Read `CLAUDE.md` (non-negotiable rules 1–11), `docs/build-guide/03-build-steps.md` → "User feedback updates" (FB-10's built notes: the draft, the preview, `where-to-play.ts`), and `docs/build-guide/04-decisions-and-risks.md` §2a (D-004).
- **The Feedback Tracker is the source of what was asked.** It is `QuoteFlow Feedback Tracker.xlsx` in SharePoint: `PMO › General › Projects › FY26 - Commercial Capital Quoting › 3. Design › Quote Flow`. If the Microsoft 365 connector is available, read the Build Backlog rows F-073 and F-020, T-036 and D-004. The tracker may not yet hold Melanie's Nov 9 answer: `markets.md` is the record. Record any difference as a deviation.
- **Authorization on the server.** Every changed or new route declares its permission through `packages/domain/src/policy`. Add permission-matrix tests that check **allowed and denied for every role** (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Finance, Approver, Leadership, Admin). Keep `docs/security/route-inventory.md` current (its test fails otherwise). Expect **no new route**: lists come through the existing config endpoints.
- **No hard-coded open rules.** The market and sub-market lists are `value_list` rows and the points are scoring-model config, all seeded `provisional: true` except where this prompt names an approver. Change config in existing environments with a **data migration**, not by editing seeds alone.
- **Audit everything** a user changes (append-only `audit_event`). Never update or delete audit rows.
- **Fabric-safe schema (rule 10).** `quote.sub_market` is a plain `text` column (no companion). No `jsonb` or array columns, no partitioning, no `TRUNCATE`. Deprecate, don't drop.
- **Migrations.** Use the next free number in `packages/db/migrations/`. FB-09 runs in parallel and also adds one. Before you open the PR, `git fetch origin main`. If a new migration has landed, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx` / `tag` in `meta/_journal.json`. Then re-run the integration tests.
- **Tests come with the feature:** domain rules → Vitest unit tests; routes → permission-matrix and integration tests (real Postgres); UI → at least one Playwright happy path through the intake.
- **Before opening the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, say so in the PR body and let CI run the integration tests. Fix every failure. Never skip or weaken a test to get green.
- Conventional Commits (`feat(intake): …`, `feat(scoring): …`), a draft PR, and the repo's PR template.

## Context
- **Market today:** `quote.market` (value list `market`: Food, Beverage, Nutrition/Supplements, Personal Care, Household Chemical, Pharma/Health, Industrial/Chemical, Pet; placeholders, `TODO(M4)` in `packages/db/seeds/config/value-lists.ts`). It is used at intake, on the quote, in the pipeline and analytics filters, the dashboards, the scoring facts and the Fabric analytics views. `grep -rn "\bmarket\b" apps packages` before you start. Pricing history has its own `market` column from the retired pricing app's export (B-15). **Leave that one alone.**
- **The draft model (FB-10):** `packages/domain/src/scoring/where-to-play.ts` (points by market), `SCORING_MODEL_V3_INPUT` and `seedScoringDraftV3` in `packages/domain/src/scoring/seeds.ts`, migration `0034_fb10_priority_calibration.sql` (`fb10-config` block), the admin preview (`config-admin/scoring-preview.ts`, Admin → Scoring model) and `packages/db/test/fb10-migration.int.test.ts`.
- **The sub-market hook already exists (FB-04):** `scoringMapSchema.bySegment` (`packages/domain/src/scoring/model.ts`) and the `map` resolver in `inputs.ts` try `bySegment` first, then the market `values`, then `default`. Use it. Don't build a second mechanism. The schema key stays `bySegment` (renaming it would churn stored models); the labels and explanations users see say "sub-market".

## Build (in this order; stop at a green, mergeable point if time runs out)

### 1. The market list (F-020)
- Load the 8 markets from `markets.md`, in its order and with its labels. **Keep** `FOOD`, `BEVERAGE` and `PERSONAL_CARE` (same meaning). **Add** `NUTRITION_WELLNESS`, `OTC_HEALTH`, `CLINICAL`, `HOME_CARE` and `AUTO_COMMERCIAL_CHEMICAL`. **Deactivate** (never delete) `NUTRITION`, `HOUSEHOLD_CHEMICAL`, `PHARMA_HEALTH`, `INDUSTRIAL_CHEMICAL` and `PET`.
- Seed and data migration both. In existing environments, change only rows still provisional and unapproved. An Admin-edited row (version > 1) is left alone and reported in the PR.
- **Sign-off:** the 8-market list is **approved by Melanie Rasche, 2026-11-09** (Danielle Leu, the FB-09 owner of the market list, passed it to her in writing). Set `provisional = false`, `approved_by = 'Melanie Rasche'`, `approved_at = 2026-11-09` on the active market rows. The deactivated rows stay as they are.
- **Existing quotes** keep their market code. A deactivated one shows its label with "(no longer offered)", as FB-03 does for `EBM_WHEEL`. Write a read-only report query (like FB-07's dry run) that lists quote numbers by retired market code, with the suggested new market from `markets.md` § "Old market codes → new". **Do not remap real quotes.** In the synthetic and demo seeds, remap to the new codes (`PHARMA_HEALTH` → `OTC_HEALTH` or `CLINICAL`, `INDUSTRIAL_CHEMICAL` → `AUTO_COMMERCIAL_CHEMICAL`, `PET` → `HOME_CARE` + Pet Care), keeping the random-draw order stable.
- Replace every hard-coded old market code you find (tests, demo data, dashboards, `where-to-play.ts`).

### 2. The sub-market field at intake
- New value list **`sub_market`**: the 30 sub-markets from `markets.md`, in its order, with its codes and labels. Each row's `meta.market` is its parent market code. `provisional = true` until Melanie answers the open questions in `markets.md` (Sun Care; Home Care › Non-Core). Say in the PR that approving it is one Admin click (or a follow-up migration) once she answers.
- New column **`quote.sub_market text`** (nullable), in the Drizzle schema, the contracts, the intake draft and submit, the quote detail and the scoring facts (`quote.sub_market`).
- **Intake wizard:** a **Sub-market** select right after **Market**, offering only the active sub-markets of the chosen market. Changing the market clears a sub-market that does not belong to the new one. Help text (config, `intake_field_help`): "Pick the closest sub-market. It sets the strategic-fit score."
- **Server rules:** a sub-market must belong to the quote's market (422 naming `subMarket`). It is cleared server-side when the market changes to one it does not belong to. **Optional:** do **not** add it to `intake_required_fields` (D-006 is FB-09's proposal; add it there as a candidate with Melanie's reason).
- **Show it** wherever market shows: quote header and summary, Engineering Product facts, the Quoting tab, Final Review, the G1 dialog and the priority breakdown, as "Market › Sub-market". Every role that reads the quote sees it (rule 2).
- **Audit:** the intake save and submit already audit field changes. Confirm `sub_market` is in that set.

### 3. The draft scoring model, re-keyed to sub-market (inactive)
- Rewrite `where-to-play.ts` around sub-markets. Export the colour bands (`strategic_growth` 80, `selectively_participate` 50, `rationalization` 20) and the sub-market → band map from `markets.md` (27 scored sub-markets). The three unscored ones (Histology, Tubes & Vials, Home Care › Non-Core) are deliberately absent. Keep the provenance comment: Melanie Rasche, 2026-11-09, provisional, D-004.
- **`SCORING_MODEL_V3_INPUT`:** v2 with only `strategic_fit` changed:
  - `map.by = 'market'`, `map.values = {}` (no market-level points; Melanie scores by sub-market)
  - `map.bySegment = { by: 'sub_market', values: <27 sub-market points> }`
  - `map.default = 50`, so a quote with a market but no scored sub-market gets the same neutral 50 as today and is neither helped nor hurt. A quote with no market keeps the existing `unknownScore` (50) and its explanation.
  - The explanation a user sees for an unscored or missing sub-market says "Pick a sub-market to score strategic fit". Weights, tiers and every other attribute are unchanged (F-005; D-004 has not set them).
- **Existing environments: data migration.** Update the inactive FB-10 draft **in place**: same `model_version`, `effective_from` still null, `provisional` true, `change_reason` now naming FB-12 and Melanie's Nov 9 answer. Do it **only** when the draft is still exactly what FB-10 seeded (its strategic-fit map equals FB-10's market points and the row is unapproved). If an Admin has edited, discarded or activated it, change nothing and report that in the PR. The seed must produce the same draft in a new database. Prove both in `packages/db/test/` (same pattern as `fb10-migration.int.test.ts`; idempotent; Admin-edited and activated drafts left alone).
- **The admin preview** (Admin → Scoring model) shows the quote's sub-market next to its market, and "strategic fit (sub-market)" as the driver when it moved the score. **Say in the PR** that until KAMs pick sub-markets, every open quote previews at the neutral 50 (no movement). Include a preview table from synthetic data where sub-markets are set.

### 4. Analytics (only if time allows before the deadline; otherwise list it as left for later)
- Add `sub_market` next to `market` in the analytics quote view and its T-SQL twin in `packages/db/sql/fabric/` (rule 10; `fabricTwins.test.ts`).
- Add a sub-market filter wherever the market filter is (pipeline, analytics).

## Tests
- **Domain:** sub-market resolution (scored → 80 / 50 / 20; unscored → default 50; no sub-market → default 50; no market → unknown 50), the draft equals v2 except strategic fit, every scored code in `where-to-play.ts` exists in the `sub_market` seed with the right parent market, and every sub-market's `meta.market` is an active market.
- **T-036:** two quotes identical except sub-market (e.g. Food › Snacks & Confections 80 vs Food › Honey & Sweeteners 20) score differently under the draft and identically under the live model. Show it in the priority breakdown.
- **Golden quotes:** re-score the five F-005 golden quotes under the new draft with the working shown (`golden.test.ts`, `calibration.test.ts`). The v2 results must not change.
- **API integration:** sub-market saved, validated against its market (422), cleared on a market change, visible to every role that can read the quote, audited. The draft is inactive and the live score is unchanged.
- **DB:** the market and sub-market migration and the draft migration, as above.
- **Playwright:** the intake picks Market → Sub-market, changing the market clears the sub-market, and the review step shows "Market › Sub-market".

## Acceptance
- [ ] Melanie's 8 markets are active and approved; the 5 old codes are inactive and still readable on old quotes; the report query lists quotes on retired codes
- [ ] the intake has an optional Sub-market filtered by Market, validated and cleared on the server, shown wherever market shows
- [ ] the inactive v3 draft scores strategic fit by sub-market at 80 / 50 / 20 with a neutral 50 default; the live model and every live score are unchanged; T-036 passes
- [ ] `pnpm verify` passes; close-out done

## Close-out: update the build docs and the change log (do this last)
1. **Build docs (same PR):**
   - In `docs/build-guide/03-build-steps.md` → "User feedback updates", add this step to the readiness table and add its section with ticked boxes and **"Built <YYYY-MM-DD>. Notes and deviations:"**. List anything built differently from this prompt or the tracker, every provisional value you seeded, and anything left for later.
   - In `04-decisions-and-risks.md` §2a, record Melanie's answer under **D-004**: segment vs market answered (sub-market, option (a)), and points 80 / 50 / 20 by colour. Say what is still open: the weights, the tier bands, activation, and her four open questions.
   - Mark `docs/build-guide/feedback/inputs/9-box.md` as superseded by `markets.md` for placement (one line at the top; keep the file).
   - Update the "User feedback updates" row in `05-path-to-mvp.md` §1, and `01-architecture.md` §5 (data model) for `quote.sub_market`.
   - Run `pnpm db:dictionary` (the schema changed).
2. **Repo change log (same PR):** in `docs/build-guide/feedback-change-log.md`, add one row per tracker item this step addressed, with these columns:
   - **Date** (today, US Central)
   - **Type** `Build change`
   - **Step** `FB-12`
   - **Change**: what was built, in words a KAM understands
   - **Feedback IDs**: the F- item plus the T-/V-/D-/Q- rows it closes or follows
   - **Raised by**: Melanie Rasche (Market Development); Danielle Leu for the hand-off
   - **Rationale**: the full reason for the change. Cover the feedback and who raised it, the decision it follows, why it was built this way, what was deliberately not done, and any provisional value awaiting sign-off.
   - **Status** `In PR`
   - **PR / commit**: the PR link once it exists

   Then change any earlier rows whose PRs have merged to `Merged`.
3. **Tracker Change Log (after the PR is open):** follow step 3 of FB-10's close-out exactly (`QuoteFlow Change Log.csv` through the Microsoft 365 connector; **never** touch `QuoteFlow Feedback Tracker.xlsx`). If the connector isn't available, end the final reply with the rows as tab-separated lines under "Paste into the tracker's Change Log tab".
4. **Final reply:** whether CI was green before the Wednesday 2 PM cut-off; what was built; deviations; the provisional values awaiting sign-off (sub-market list, points, the three unscored sub-markets); which T- scenarios are ready to test; and the PR link.
