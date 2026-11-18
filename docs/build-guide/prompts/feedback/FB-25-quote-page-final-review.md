# FB-25 · Quote page and Final Review: a Commercial terms tab, Overview as a summary, To qualify opens from the notice, one "Decide final review"

**Run with:** Claude Code · **Opus 5.5** · **high** effort · **Wave 1**, in parallel with FB-21, FB-22 and FB-24 · one draft PR · branch `claude/fb-25-quote-page-final-review`
**Feedback items:** N17-18, N17-25 to N17-29, N18-17, N18-18, and the Final Review half of N18-02 (`docs/build-guide/feedback/inputs/feedback-2026-11-17.md`) · **Tracker rows it follows:** UX-012 (open the quote on the reader's work), FB-08 (commercial terms and Final Review), FB-11 (payment terms), D-029 (tooling payment), FB-17 (gate decisions)

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-21-to-27-ground-rules.md` in full.
2. **You own:** `apps/web/src/routes/quotes/$quoteNumber.tsx`, `apps/web/src/lib/quote-tabs.ts`, `apps/web/src/components/commercial/*` (including `FundingHelp.tsx`), `apps/web/src/components/final-review/*`, `apps/web/src/routes/approvals.tsx`, the notification link code (`apps/web/src/lib/notification-target.ts`, `components/notifications/NotificationRow.tsx`, the digest links in `apps/api/src/services/emailContent.ts`), and `packages/domain/src/commercial/*`. **Running beside you:** FB-21 (Quoting tab; it may touch `apps/api/src/services/final-review.ts` so a pending capital readiness never blocks G4), FB-22 (Engineering tab; it gives the decision section the anchor `#decision`), FB-24 (intake; it adds an optional customer tooling commitment at intake writing the same column you make required at Final Review). Do not edit their files.

## What the code does today (read 2026-11-18 at `f017ccc`; verify before relying on it)
- **Tabs** (`lib/quote-tabs.ts` ~5; labels `$quoteNumber.tsx` ~71-76): Overview, Engineering, Quoting, Attachments. `useQuoteTab` (~101-127): `?tab=` wins; a `#hash` (e.g. `#commercial`) forces Overview; otherwise `defaultQuoteTab` (`quote-tabs.ts` ~37-50) opens Engineering or Quoting for someone who works that stage (UX-012), else Overview. The bar is at ~333-343. In the demo several people did not notice it; Faron could not find the engineering and capacity notes on a closed quote until Bailey pointed at the Engineering tab and "Capacity at a glance".
- **Overview** (~344-383), in order: Offer letter card (with `offer.read`), Hand-off card (Commit & Hand Off / Awarded only), Closure card, **Commercial terms panel** (`components/commercial/CommercialPanel.tsx`, card `id="commercial"`), then IntakeCard beside "Why this priority?" and "Gate decisions", then the timeline. Above the tabs: stage, priority, gate rail, next-step line, Salesforce reminder, customer-decision header, rework banner, qualification warnings, guardrail note, stage time bar.
- **Commercial terms panel:** CapitalFlag, CustomerRequested, TermsEditor (payment terms, tooling payment, customer tooling commitment, milestone note, **Non-standard terms** checkbox, notes, Terms checked, Legal fields), EngineeringTerms (tooling funding model, MOQ), CapitalTerms (funding model in finalize mode, mold ownership, amortized, agreement, minimum supply; "Confirm capital terms"), exceptions and approvals, Escalate. `terms.edit`: KAM own, SalesLeader, Pricing, PricingLead; `terms.finalize`: Approver at Final Review. Locked after G4 Advance.
- **Non-standard terms** (`CommercialPanel.tsx` ~552-564): always shown in the editor; checked and disabled when the payment code is not in `standard_payment_terms` (seed `NET_15`, `NET_30`); **can be ticked by hand at Net 15 / Net 30**, which sets `termsNonstandard` and so trips the Legal trigger `nonstandardTerms` (`packages/domain/src/commercial/terms.ts` ~66-81; triggers in `legal_review_triggers`). The G4 message "A Legal review is triggered but no review date is recorded" (`g4-checks.ts` ~98-108) is a warning unless `legal_review` is in `g4_required_checks` (seed `terms_exception`, `terms_finalized`).
- **Required at Final Review today:** confirming capital terms needs every item of `capital_terms_required` (seed: funding model, **mold ownership**, amortization, minimum supply, agreement; "Not discussed" counts as unanswered, `terms.ts` ~229-258), and confirmation (`terms_finalized`) blocks G4 Advance. **Customer tooling commitment** is needed only to tick "Terms checked" (`terms.ts` ~489-497), which is a warning. Nothing shows these as required on screen.
- **Final Review decision bar** (`components/final-review/ReviewScreen.tsx` ~787-849): one button per available outcome: Stop (withdraw), Hold, Send back to Quoting or Engineering, Advance (release the offer); each opens `GateDecisionDialog` with that outcome chosen (~185-198). The dialog itself groups Advance / Send back to… / Hold / Stop (`lib/decision-groups.ts`). The quote header has "Review and decide" (`$quoteNumber.tsx` ~231-242).
- **Funding help** (`components/commercial/FundingHelp.tsx` ~7-44): a Radix popover, width `min(28rem, 100vw-2rem)`, **no max height or scroll**, so it runs off the screen on a laptop (Ben, WT3b 0:24). Used in the Commercial panel, Capital terms and the intake.
- **To qualify** (`routes/approvals.tsx`, tab `to-qualify`, `GateQueue gateKey="G1"`): cards (~271-358) show rank, quote link, priority, customer and opportunity, product, volume, revenue, KAM, request class, qualification warnings and **Decide**; they do not expand. The `quote.to_qualify` notice goes to the G1 deciders (SalesLeader) as a **daily digest**; in-app it opens `/quotes/<n>` on Overview (`notification-target.ts` ~36, `NotificationRow.tsx` ~54); the digest email's rows link to `/quotes/<n>` and its button to `/approvals?gate=G1` (`emailContent.ts` ~185-190).

## Build

### A. To qualify opens from the notice, and its cards expand (N18-17)
Ben and Bailey (S18 0:20-0:26): a sales leader clicking the notice lands on the quote's Overview "with these empty fields" and does not know what to do; they only need to decide advance or stop. 
1. The `quote.to_qualify` notice (in-app and the digest's rows) opens **To qualify** with that quote's card expanded and scrolled into view (`/approvals?tab=to-qualify&quote=<n>`). Any other notice keeps its target.
2. Each To qualify card gets a **Show details / Hide details** toggle that expands a read-only summary of what the KAM entered (request, commercial inputs, items with their product facts and volumes, files), reusing the IntakeCard's rendering. **Expand all / Collapse all** at the top. Load details on expand if the queue payload does not carry them (respect RLS and `quote.read`). Keyboard and screen-reader friendly (`aria-expanded`).

### B. Commercial terms get their own tab; Overview becomes the summary (N18-18, N17-18)
1. Tabs: **Overview · Engineering · Quoting · Commercial terms · Attachments**. The Commercial terms panel moves to its tab unchanged in behaviour. `#commercial` links, the payment-terms exception notice (UX-012) and any `?tab=` use open the new tab; keep old links working (`/quotes/<n>#commercial` → the Commercial terms tab). `defaultQuoteTab`: a SalesLeader at Intake, and anyone with `terms.edit` whose work is the terms, opens Commercial terms; the rest as UX-012.
2. **Overview is read-only**: keep the action cards that belong to the stage at the top (offer letter, hand-off, closure), then **"At a glance"** sections: the intake (IntakeCard), **Engineering** (per item: plant, process & machine, cavitation, cycle time, budgetary capital, the engineer's notes and the capacity notes, and who decided G2), **Pricing** (status of costing / payback / price approval, capital readiness), **Commercial terms** (the agreed terms, read-only, with a link "Edit on the Commercial terms tab" for those who can), "Why this priority?", Gate decisions, and the timeline. Rows with no value are left out. No inputs on Overview.
3. **Make the tab bar hard to miss:** larger tab labels, a clear selected state, the bar stays visible under the page header when scrolling (sticky; check 390 px and that it does not cover focused fields, UX-018), and a small dot on a tab where the reader has work waiting (reuse UX-002's `nextStep`). The Final Review route (`/quotes/<n>/review`) keeps its own layout.

### C. Final Review: one decision button, shown twice (N17-25)
Ben and Bailey (WT3b 0:29-0:31): every outcome button opens the same panel anyway; use one, and repeat it under the commercial terms so the approver need not scroll back up. Replace the decision bar's outcome buttons with one **Decide final review** that opens `GateDecisionDialog` with no outcome preselected (the dialog's groups do the rest; check the dialog supports this as G1 and G2 do), and add the same button below the terms and legal section. Keep the warnings that say what blocks a release (UX-010) next to the first button. Update tests that clicked the old buttons (behaviour change; list them in the PR).

### D. What Final Review requires, and showing it (N17-26, N17-27, Final Review half of N18-02)
1. **Customer tooling commitment answered** becomes a G4 Advance requirement: add a check `tooling_commitment_answered` to `g4-checks.ts` and add it to `g4_required_checks` by guarded data migration (only where the setting is unedited and unapproved). The KAM's intake answer (FB-24) counts.
2. **Tooling funding model** and **mold ownership** are already required to confirm capital terms: show them (and every item of `capital_terms_required`, and the tooling commitment) with the red required marker from FB-15 in the Final Review terms section, and list any missing one under the release blockers with a link to the field.
3. Nothing new is required earlier (Jim and Gemma: mold ownership is not needed for the quote, only at Final Review).

### E. Non-standard terms and Legal (N17-28)
When the payment terms code is standard (`standard_payment_terms`), **hide** the Non-standard terms checkbox and keep `termsNonstandard` false on the server (normalize on save; the Legal trigger for non-standard terms then cannot fire from a standard code). A non-standard code keeps today's behaviour (ticked and disabled). With no code chosen the checkbox stays available. For open quotes that hold a standard code with the box ticked, clear it in the migration with an audit row by the system actor. Tests for each case and for the Legal trigger.

### F. The funding help fits the screen (N17-29)
Give `FundingHelp`'s popover a max height within the viewport and its own scroll (as the pipeline column chooser does), let it flip side on collision, and check it at 1366 × 768, 390 px and 320 px in both themes, from the Commercial panel, Capital terms and the intake.

### G. Small reads
- Final Review's engineering summary (`ReviewScreen.tsx` ~584) leaves out rows with no value, so "Technical concept" disappears for new quotes (FB-22 stops collecting it).

## Tests
Domain: the new G4 check, the non-standard normalization and the Legal trigger. API integration: the notice link payload, the To qualify details read (RLS: a SalesLeader sees them, a KAM only for their own), the migration for the setting and the cleared flags. Web component tests: tab defaults (the hash redirect, SalesLeader at Intake), the Overview has no inputs, the expandable cards. Playwright: a SalesLeader opens the to-qualify notice, expands a card and advances; an approver uses **Decide final review** from under the terms; the funding help stays on screen. Permission matrix for any changed route. 1366 × 768, 390 px and 320 px, both themes, axe.

## Questions to put to Bailey (draft them; send nothing)
1. Is the tab order Overview, Engineering, Quoting, Commercial terms, Attachments right?
2. With Net 15 / Net 30, is there ever another non-standard term (not payment) that should still be flagged by hand?
3. Does the sales leader also need the "At a glance" summary on To qualify for multi-item quotes, item by item (built: yes)?

## Done when
- [ ] to-qualify notices open To qualify on the card; cards expand; Expand all / Collapse all
- [ ] Commercial terms tab; old links redirected; Overview read-only with "At a glance"; the tab bar easy to see
- [ ] one **Decide final review**, shown twice
- [ ] tooling commitment required at G4 (setting); required markers and blockers shown; mold ownership and funding model visible as required
- [ ] non-standard checkbox hidden at standard codes, normalized on the server, open quotes cleaned
- [ ] funding help fits the screen
- [ ] tests as listed; `pnpm verify` passes; close-out done (ground rules)
