# FB-22 · Engineering tab: both parts submit to the lead, fewer free-text boxes, a platform field, jump to the decision, "New" in the queue

**Run with:** Claude Code · **Opus 5.5** · **high** effort · **Wave 1**, in parallel with FB-21, FB-24 and FB-25; **merge after FB-21** and rebase on it (you both touch lead review and the notification catalogue) · one draft PR · branch `claude/fb-22-engineering-tab`
**Feedback items:** N17-11, N17-12, N17-13, N17-14, N17-16, and Ben's decision D2 (a lead may approve their own work) (`docs/build-guide/feedback/inputs/feedback-2026-11-17.md`) · **Tracker rows it follows:** L-9 (lead review), FB-16 (Production Scheduler, W13-15), D-008 (engineering roles, open)

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-21-to-27-ground-rules.md` in full.
2. **Other steps:** FB-21 (Quoting tab, pricing queue, the pricing half of lead review), FB-24 (intake), FB-25 (quote page tabs and header, Overview, Commercial terms, Final Review). Do not edit `QuotingTab.tsx`, `QuotingSteps.tsx`, `routes/quotes/$quoteNumber.tsx`, `components/final-review/*` or the intake. **FB-23 follows you** and adds the cost-estimate and pack-out fields to the Engineering tab: keep your structure changes small and say in the PR what you moved.
3. **Ben decided (2026-11-18, record D2): a lead may approve their own work.** See Build E.

## What the code does today (read 2026-11-18 at `f017ccc`; verify before relying on it)
- **Engineering tab** (`apps/web/src/components/engineering/EngineeringTab.tsx` ~127-203), in order: IntakeFactsHeader, ProductFactsHeader, AssignmentCard, LeadReviewStatus, SectionLockLine, (multi-item: EquipmentBomCard, CapacitySignoffCard, ItemSwitcher), SolutionCard, EquipmentBomCard, PricingInputsCard, LegacyNotes, CapacityCard, CapacitySignoffCard, **LeadReviewActions** last.
- **Solution fields** (`eng_review`, one row per item; `packages/db/src/schema/workflow.ts` ~1344-1377): plant, one "Process & machine type" pick (process derived, FB-16), cavitation, cycle time, `tooling_notes` (label "Tooling notes (mold, hot runner)", ~762), `prelim_capital_usd`, `technical_concept_notes` (label "Technical concept", ~771), `supply_chain_notes` (label "Supply Chain", ~780-792). No machine-platform field. No workflow rule, readiness check, analytics view or offer-letter code reads technical concept or supply chain; the G2 evidence snapshot copies technical concept (`apps/api/src/services/gateService.ts` ~846); Quoting's and Final Review's engineering summaries show technical concept (`QuotingTab.tsx` ~387, `ReviewScreen.tsx` ~584; FB-21 and FB-25 hide those rows when empty). `docs/build-guide/feedback/engineering-estimate-mapping.md` ~87 maps the workbook's Charter / Scope text to `technicalConceptNotes`.
- **Lead review (engineering)**, `packages/domain/src/lead-review/index.ts`: kind `engineering`, gate G2 `proceed`, lead permission `gate.G2.decide` (EngLead), work permission `engReview.edit` (`{ EngLead: true, Engineer: assigned }`, `policy/matrix.ts` ~89), lead-only field `capacity_signoff_status`. `canSubmitToLead` (~163-176) requires the actor to be `quote.assigned_engineer_id`. **The production scheduler cannot submit** and sees no submit text; FB-16 lets the lead send work back to either person (`RETURN_TARGETS`). Route `POST /quotes/:quoteNumber/eng-review/submit` (`apps/api/src/routes/v1/engineering.ts` ~263); service `apps/api/src/services/lead-review.ts` ~146. Notice `quote.submitted_to_lead` to every EngLead; the KAM gets in-app `quote.lead_review_update`. Button text "Submit to engineering lead" (`LeadReviewPanel.tsx` ~241).
- **Capacity notices:** `quote.capacity_assigned`, `quote.capacity_ready` ("Capacity can start", fired when the engineer saves plant and machine; Ben confirmed it works on Nov 18) and `quote.capacity_blocked`.
- **"Decide feasibility"** (`lib/decision-label.ts` ~9) is the lead's primary button inside `LeadReviewActions` at the bottom of the tab (`data-testid="decide-gate"`) and also in the quote header (`$quoteNumber.tsx` ~242-252, `header-decide`) when ready. Bailey (lead) opened the quote and had to scroll the whole page to find the decision.
- **Engineering queue** (`apps/web/src/routes/queue/engineering.tsx`): status text Unassigned / "Not started" / "In review" (~57-61), overridden by "Ready for lead review" or "Sent back by lead". `eng_review.accepted_at` records "Start review" (`queueStatus`, `apps/api/src/services/engineering.ts` ~267). Nothing marks the scheduler's capacity part as not started.

## Build

### A. Both parts submit to the engineering lead (N17-14)
Ben (WT3a 0:56, S18 0:30): "once the engineer and the production scheduler finish their parts, there should be a button to submit their work for approval back to the engineering lead", which notifies the lead.
1. **Two parts, one review.** The engineer's part (solution, BOM, pricing inputs) and the scheduler's part (capacity rows) are each marked submitted by their owner: the engineer with **Submit to engineering lead**, the scheduler with **Submit capacity to engineering lead**. Store the scheduler's submission (who, when) beside the existing lead-review state; Fabric-safe, audited, on the timeline.
2. **When the lead is told** (provisional, a setting `eng_lead_notify_when`, seed `both_parts`): the EngLead gets `quote.submitted_to_lead` once **both** parts are submitted, or once the engineer's part is submitted on a quote with no scheduler assigned. Each submission also tells the other person ("Faron submitted capacity for CCQ-…"). The quote reads "Ready for lead review" only then.
3. **Permissions:** the scheduler's submit needs `capacity.edit` on a quote where they are `assigned_scheduler_id`. A send-back to the scheduler (FB-16) clears their submission; a send-back to the engineer clears the engineer's. The lead may still decide at any time (L-9). Permission-matrix tests for every role on the new route.
4. **Lock:** while a part is submitted, its owner's fields are read-only (as L-9 does for the engineer today) until the lead sends it back.
5. **Screens:** each person's button sits at the end of their own section ("Engineer's part" / "Your part" labels from FB-16 stay, `EngineeringTab.tsx` ~330-341), with the same "Still needed" list when it cannot be submitted. The lead sees which part is in and which is not.

### B. Jump to the decision (N17-11)
When a user who can decide G2 opens the Engineering tab and the quote is waiting for them, show a **Go to the decision** link at the top that scrolls to `LeadReviewActions` and moves keyboard focus there (respect reduced motion). Give the decision section a stable anchor (`#decision`) and support `?tab=engineering#decision`. FB-25 owns the quote header this wave: if its **Decide feasibility** button does not land on that anchor after both merge, list it in the PR for FB-27. Do not auto-scroll the page on load (the lead may want to read first, as Bailey said).

### C. Remove "Technical concept" and "Supply chain"; ask for the platform and hot runner (N17-12, N17-13)
1. **Hide** both boxes from the edit form and stop writing them. **Keep the columns** (deprecated in the schema comment and the data dictionary) and show an old non-empty value read-only under the existing "Legacy notes" heading. Leave the G2 evidence snapshot as is (it copies whatever the column holds). Update `engineering-estimate-mapping.md` (Charter / Scope text now goes in the tooling notes or is not captured; say which).
2. **Machine platform** (Jim, Demo 0:59-1:01: platforms differ by plant and machines move, so not a list): an optional short text field per item, `machine_platform` (≤ 80), under "Process & machine type", hint "The machine you are quoting on, for example its model or line". Fabric-safe; contract, API, audit. After you rebase on FB-21, add it as one row of Quoting's engineering summary (that one-row change in `QuotingTab.tsx` is allowed) and to Final Review's engineering summary only if FB-25 has merged (otherwise list it for FB-27).
3. **Hot runner:** relabel "Tooling notes (mold, hot runner)" to **"Tooling notes"** with the hint "Say whether the mold has a hot runner, and anything else about the tooling." (No new field: Bailey wants fewer free-text boxes; Jim asked for "a note".)

### D. "New" in the engineering queue (N17-16)
Faron (Demo 1:16): "some type of call-out or color scheme that says not reviewed yet". Provisional: a **New** chip (accent colour, with text, not colour alone) on a queue row when the reader is the assigned engineer and has not clicked Start review, or the assigned scheduler and has not saved a capacity row. It goes away by itself once they start. Add a "New to me" quick filter. Respect RLS; no new table (derive it from `accepted_at` and the capacity rows).

### E. An engineering lead may approve their own work (record D2)
In the demo (1:08) Jim, who holds EngLead and Engineer, assigned the quote to himself, did the work, and could not decide G2; Ben took over as lead. **The code has no rule against it:** the seeded segregation rules (`packages/domain/src/workflow/seeds/hybrid.ts` ~744-766) bar only the KAM at G1 and G4 and the price approver at G4, and `canSubmitToLead` gives a lead no submit button because a lead decides directly. So find what stopped Jim: reproduce with synthetic data (a user with EngLead and Engineer, assigned as the engineer, with and without a production scheduler) and check the decision button, the "Still needed" list (capacity sign-off, the scheduler's part from Build A) and any check that compares the decider with `assigned_engineer_id`. Fix the cause. With Build A, when the lead is also the engineer, their own part needs no submit; with a scheduler assigned, the lead is told when the scheduler submits and then decides. Prove it with an integration test and a Playwright step. If the test environment has an extra `segregation_rule` row an Admin added, note it in the PR for Ben; do not change environment data.

## Tests
Domain: the lead-who-is-the-engineer case, the two-part submit rules (engineer only, scheduler only, both, no scheduler assigned), a send-back clearing the right part, the "New" rule. API integration: the scheduler's submit route, the notices to the lead and to the other person, the locks. Permission matrix for every role. Playwright: the engineer and the scheduler each submit; the EngLead is told and decides from "Go to the decision"; a scheduler sees a New chip in the queue. Check the Engineering tab and the queue at 1366 × 768 and 390 px in both themes.

## Questions to put to Bailey and Jim (draft them; send nothing)
1. Should the lead be told when each part is in, or only when both are (built: both)?
2. Is a free-text "Machine platform" enough, or does Jim want a list per plant later?
3. Where should Charter / Scope text from the estimate workbook go now that Technical concept is gone?

## Done when
- [ ] engineer and scheduler each submit their part; the lead is told per the setting; locks and send-backs per part; matrix tests
- [ ] "Go to the decision" and the header's Decide feasibility land on the decision
- [ ] Technical concept and Supply chain no longer asked (old values read-only); machine platform field; tooling notes relabelled
- [ ] "New" chip and "New to me" filter in the engineering queue
- [ ] an engineering lead assigned as the engineer decides G2 on their own work (cause of the Nov 17 block found, fixed and tested)
- [ ] tests as listed; `pnpm verify` passes; rebased on FB-21; close-out done (ground rules)
