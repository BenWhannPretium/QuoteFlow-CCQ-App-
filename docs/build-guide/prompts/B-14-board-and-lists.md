# B-14 · Pipeline board, quote list, approvals and prioritization views, CSV export (F-07)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and the components from B-05. PRD F-07 asks for a "compact filter button pattern (search + Filters popover + inline sort)" across four views: **Pipeline (kanban)**, **Quotes (list)**, **Approvals (Final Review queue)** and **Prioritization (scored list)**. The Approvals view exists from B-12; make it consistent.

## Shared query layer
`GET /api/v1/quotes` supports:
- `q` (quote number, opportunity name, account, description; trigram)
- `stage[]`, `tier[]`, `kam[]`, `engineer[]`, `productFamily[]`, `market[]`, `resin[]`, `status`
- `agedOverDays`, `closeDateFrom/To`, `hasWarnings`, `sfMismatch`
- `sort` (score, tier, age, closeDate, amount, updated)
- `page`/`cursor`

Results are scope-filtered by RLS **and** policy, and redacted per role. Filters serialize into the URL (shareable links). Saved views live in `localStorage` (try/catch; per-user convenience only).

## Views
1. **Pipeline board** (`/board`)
   - One kanban column per active stage, read from the stage config.
   - Terminal stages collapse into "Closed (n)" with a toggle.
   - Card: tier chip, score, quote number, account, product one-liner, volume, KAM avatar, time in stage, warnings dot.
   - **Drag between columns only where a transition is allowed for the actor.** Use `availableActions` from the domain; dropping opens the `GateDecisionDialog` with the matching outcome preselected, and cancelling snaps the card back. Disallowed drops show a tooltip explaining why.
   - Use dnd-kit, keyboard accessible. On mobile, columns swipe horizontally with stage tabs; drag is disabled on touch and "Move" opens the dialog.
   - Column header: count + total amount. Amount is commercial-sensitive? **No.** The SF amount is visible to all per Salesforce visibility (PRD: mirror SF), but capital and price are not.
2. **Quotes list** (`/quotes`)
   - DataTable with column chooser, inline sort and row click → detail.
   - Mobile card layout.
3. **Prioritization** (`/quotes?view=priority`)
   - Scored list with the breakdown expandable inline, override markers and the "Why this priority?" popover.
   - The open question "Can KAMs see peers' scores?" is honoured via the setting (B-08).
4. **Approvals:** align with the same filter/sort pattern.

## Global search (header)
Type-ahead over quote number, opportunity name and account (top 8 results, keyboard navigable). Enter opens the full list.

## CSV export (`export.csv`)
- `GET /api/v1/quotes/export.csv?<same filters>` streams CSV. The columns are the visible list columns. Commercial fields are included only for roles allowed to see them.
- Writes `audit_event action='export'` with the filters and row count.
- Cap at 5,000 rows; if more, return 422 telling the user to narrow the filters.

## Performance
Seed 500 synthetic quotes for a perf test: the board renders in < 1.5 s, and the list API p95 is < 300 ms. Add the indexes from architecture §5 if they're missing. Use `EXPLAIN ANALYZE` in a test script.

## Tests
- API filter combos; scope + redaction on list and export; export audited; 5k cap.
- Board: allowed vs disallowed drag per role (unit-test the mapping from `availableActions` to droppable columns).
- Playwright: filter, then sort, then open a quote; an EngLead drags ENG_REVIEW → QUOTING, which opens the G2 dialog.

## Acceptance
- [ ] Four views consistent; filters in the URL; mobile usable
- [ ] Export works, is redacted and is audited
- [ ] Performance targets met on 500 quotes
- [ ] Tick B-14 in `docs/build-guide/03-build-steps.md`
