# FB-27 · Lists, timeline and polish: plant in the pipeline, movable columns, file links and score changes on the timeline, the hand cursor, formats on every upload, "Report an issue"

**Run with:** Claude Code · **Sonnet 5.5** · **high** effort · **Wave 2: start when FB-21, FB-22, FB-24 and FB-25 have merged** (you finish small pieces of each) · in parallel with FB-23 and FB-26 · one draft PR · branch `claude/fb-27-lists-timeline-polish`
**Feedback items:** N17-15, N17-17, N17-33, N17-34, N17-35, N18-16, the rest of N17-09 and N17-24, and any follow-ups FB-21, FB-22, FB-24 and FB-25 listed for FB-27 in their PRs (`docs/build-guide/feedback/inputs/feedback-2026-11-17.md`)

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-21-to-27-ground-rules.md` in full.
2. Confirm FB-21, FB-22, FB-24 and FB-25 have merged into `main`. If not, stop and say so. Read their PRs' "Left for FB-27" notes (for example the quote header's Decide feasibility anchor, the machine platform on Final Review) and do those too, if each is small; list any you leave.
3. **You own:** the pipeline list (`apps/web/src/routes/quotes/index.tsx`, `components/pipeline/*`, `lib/saved-views.ts`, `packages/contracts/src/pipeline.ts`, `apps/api/src/services/pipeline.ts`), `components/QuoteTimeline.tsx`, `components/attachments/*`, `components/feedback/ReportIssue.tsx`, the analytics labels, the global stylesheet. **Running beside you:** FB-23 (Engineering tab; it may add per-item CSV columns to the pipeline export; you merge first and FB-23 rebases) and FB-26 (re-quote, expiry, hand-off; it may add timeline event labels). Do not edit the Engineering tab or the outcome components.

## What the code does today (read 2026-11-18 at `f017ccc`; verify before relying on it)
- **Pipeline list** (`routes/quotes/index.tsx`): columns from `QUOTE_LIST_COLUMNS` (`packages/contracts/src/pipeline.ts` ~227-258); the chooser (`components/pipeline/parts.tsx` ~146-210) only ticks columns and always places them in catalogue order (~192); the choice is per user in `localStorage` `ccq.quoteColumns.<userId>` (`lib/saved-views.ts` ~67-85); saved views (`ccq.savedViews.<userId>.<view>`, up to 20) store the URL search (filters and sort), **not the columns**. Filters (`QuoteFilterQuery`, `packages/contracts/src/pipeline.ts` ~43-66): q, stage, tier, KAM, engineer, product family, market, resin, status, aged, close date, warnings, SF mismatch. **No plant column or filter.** Plant lives per item on `eng_review.plant_code`; the per-item CSV already has an "Item plant" column (header in `QUOTE_ITEM_EXPORT_COLUMNS`, `packages/contracts/src/pipeline.ts` ~294; value filled in `apps/api/src/services/pipeline.ts` ~499-508), and `QuoteItemSummary.plantCode` exists.
- **Timeline** (`components/QuoteTimeline.tsx` ~193-211): file events are plain text ("File uploaded: <name>"). Priority: only `priority_tier_changed` (~146-151), written by `apps/api/src/services/scoring.ts` ~96-114 only when the **tier** changes; the score itself is overwritten in place (`setQuotePriority`), so 53 → 61 inside a tier leaves no trace.
- **Download links:** `AttachmentDownloadLink` (`components/attachments/Attachments.tsx` ~528-548) is a `<button>`; the shared `Button` has no cursor class. **Tailwind is v4** (`apps/web/package.json`: `tailwindcss` 4.3.3), whose preflight gives buttons the default arrow; no stylesheet in `apps/web/src` sets a cursor.
- **Formats:** after FB-21, `packages/domain/src/attachments` has a helper giving a kind's accepted formats and size limit (find it in FB-21's PR). The general panel's hint is hard-coded (`Attachments.tsx` ~294-297); the equipment BOM upload (`components/engineering/EngineeringExtras.tsx` `BomUpload` ~120-180) and the capacity-analysis upload (`EngineeringTab.tsx` `CapacityEvidenceActions` ~1576-1611) show none.
- **"Report an issue"** (`components/feedback/ReportIssue.tsx`): Send is disabled while the description has fewer than 5 characters (~154, ~309), and nothing says so; **Cancel** and closing only call `setOpen(false)` (~298-305, ~159-162), so the form keeps its type, severity, text and screenshot; `reset()` runs only after a successful send. **The Admin page already exists:** Admin → Feedback (`routes/admin/feedback.tsx`, `feedback.triage`, Admin only).
- **Analytics** (`apps/web/src/analytics/AnalyticsPage.tsx` ~624-630): the tile "Awarded, commitment pending", hint "Awarded by the customer and waiting in Commit & Hand Off (CER and hand-off). Already in the awarded count and win rate."
- **Red / yellow:** FB-24 added `components/ui/flag-key.tsx` and a red tint for blocking notices on the intake. The gate dialog ("Missing before it can move on", `GateDecisionDialog.tsx` ~484-510), the lead-review "Still needed" list (`LeadReviewPanel.tsx`) and Final Review's release blockers use their own styles.

## Build

### A. Pipeline: plant, movable columns, views that keep them (N17-17)
Faron (Demo 1:55-1:56): "it would be nice to see the plant in the pipeline view … filtering by plant", so a plant can see what is lined up for it; Gemma agreed (capacity). Bailey: "reorder the columns and be able to save that view based on that person's preferences".
1. A **Plant** column: the plant labels of the quote's items, distinct, in item order ("Aurora · St. Louis"), blank before Engineering picks one. A **Plant** filter (multi-select from the plant value list): quotes with any item at that plant. Server-side in the contract, the repo query and the CSV; the board view shares the filter. RLS unchanged.
2. **Reorder columns** in the chooser (Move up / Move down buttons, keyboard-accessible; drag optional with dnd-kit, already a dependency) and keep the order.
3. **Saved views hold the columns and their order** as well as the filters and sort they hold today (older saved views without columns keep the current columns). Storage stays per user in `localStorage` with try / catch, as today; say in the PR that views do not follow the user to another device.

### B. Timeline: file names open the file, score changes are shown (N17-34, N17-15)
1. **File events** ("File uploaded", model uploads, "File removed" not linked) show the file name as a link that opens the existing audited download for that attachment version, when the reader may download it (the same permission and RLS as the Attachments tab). A removed file's name stays plain text.
2. **Score changes:** whenever a recalculation changes the score, write one `priority_score_changed` event (from, to, the tier before and after, the trigger: an input change or a model activation). Show it as "Priority score up 53 → 61 (Standard)" or "down … ", with the tier change in the same line when there is one. Keep reading old `priority_tier_changed` events; stop writing a second event for the same recalculation. Bailey wanted this for the history, mainly for Pricing.

### C. The hand cursor on everything clickable (N18-16)
In the global stylesheet's base layer, give enabled buttons, `[role="button"]`, links styled as buttons, `summary`, `select` and file-picker labels `cursor: pointer`; disabled ones `not-allowed`. Check the equipment BOM link (Ben's example), every download link, tabs, chips and menu items.

### D. Formats beside every upload (rest of N17-24)
Use FB-21's helper for the general Attachments panel (replacing the hard-coded hint), the equipment BOM upload, the capacity-analysis upload, and FB-26's CER proof if it has merged: the words beside the button and the picker's `accept` per kind. (Editing `EngineeringExtras.tsx` and `EngineeringTab.tsx` for these two uploads only is allowed; FB-23 may be open: keep the change to the upload controls and rebase.)

### E. "Report an issue" (N17-35)
Cancel, Esc and closing clear the form (type, severity, text, screenshot). While Send is disabled, say why under the box ("Describe the issue in at least 5 characters."). After sending: "Thanks: your report was sent." The Admin page exists; check that Ben's Admin account sees the Nov 17 test report there and say so in the PR (no change expected).

### F. Analytics wording (N17-33)
Rename the tile to **"Awarded, hand-off not done"** with the hint "The customer awarded it; the CER and hand-off are still open. Counted as won." (provisional words; ask Bailey). Keep the figure as it is.

### G. Red and yellow everywhere (rest of N17-09)
Apply FB-24's blocking tint and `flag-key` to the gate decision dialog's "Missing before it can move on", the lead-review "Still needed" list and Final Review's release blockers; warnings stay amber. The key shows only when a flag is on screen. AA contrast in both themes.

## Tests
Contracts and API integration: the plant filter and column (multi-item, no plant yet, RLS), the CSV. Domain / service: the score-change event (up, down, unchanged, with and without a tier change, model activation). Web component tests: column order and saved views with columns (old views still load), the timeline link vs plain name, the Report-an-issue reset, the cursor rule. Playwright: Faron's case: filter the pipeline by a plant, move the Plant column first, save the view, reload; click a file name on the timeline. 1366 × 768 and 390 px, both themes, axe.

## Questions to put to Bailey (draft them; send nothing)
1. Is "Awarded, hand-off not done" clear? 
2. Should saved views follow a person between devices (needs server storage; not built)?

## Done when
- [ ] Plant column and filter; columns reorder; saved views keep columns and order
- [ ] timeline file names link to the download; score changes on the timeline
- [ ] pointer cursor on clickable things
- [ ] formats beside every upload
- [ ] Report an issue resets and explains the disabled Send
- [ ] analytics tile reworded
- [ ] red / yellow and the key on the gate, lead and Final Review panels
- [ ] the FB-21 / 22 / 24 / 25 follow-ups done or listed
- [ ] tests as listed; `pnpm verify` passes; close-out done (ground rules)
