# FB-23 plan: engineering cost estimate and pack-out, per item

Feedback N18-03 to N18-10, N18-14; Ben's decisions D4, D5, D6 (record `inputs/feedback-2026-11-17.md`).
Read from `main` at `49223db` (FB-21, FB-22 and FB-24 merged) on 2026-11-19. Synthetic data only. Any later
change of plan is recorded as a deviation in `03-build-steps.md` (FB-23).

## What the code does today (checked, differences from the prompt's note)
- As the prompt says: `eng_review` one row per `quote_item`; pack-out `units_per_bag / _tray / _case /
  _pallet` (1 to 9,999,999, `eng_review_pack_out_check`); `pack_out_rule` (`notTogether: [bag, case]`,
  `requireOneOf: false`); no cost, lead-time, labor or pallet fields anywhere.
- The two-step and pack-out inputs are one card, `PricingInputsCard` ("Two-step process and pack-out",
  `EngineeringExtras.tsx`), saved through `PUT /quotes/:qn/eng-review` with `itemId`.
- The Quoting tab's "From engineering" (`EngineeringInputsCard`) shows **item 1 only** (`quote.engineering.review`).
- `upsertEngReview` writes every column in `ENG_REVIEW_FIELDS` from the values passed (the capacity sign-off
  re-writes the row through `reviewColumns`), so each new column joins both lists or a sign-off would clear it.
- `value_list.meta` (jsonb, already mirrored through its companion) can carry per-entry attributes.

## A. Data model (one migration; numbered at PR time, 0053 locally)

### `eng_review`, per item (all optional)
| column | type | rule |
|---|---|---|
| `mold_lead_time` | text | ≤ 40 ("16-18 weeks") |
| `packers_per_line`, `operators_per_line` | numeric(6,2) | 0 to 99.99 |
| `pack_method` | text | value list `pack_method` code |
| `pack_container_item_no` | text | ≤ 40, free text (D6) |
| `pack_container_description` | text | ≤ 120 |
| `containers_per_layer` | integer | 1 to 9,999 |
| `layers_per_pallet` | integer | 1 to 999 |
| `pallet_build_height` | text | ≤ 20, unit as typed ("96 in") |
| `pallet_type` | text | value list `pallet_type` code |
| `pallets_per_trailer` | integer | 1 to 999 (53-ft trailer) |
| `special_packaging_note` | text | ≤ 300 (D4) |
| `returnable_dunnage_description` | text | ≤ 200 (D4) |
| `returnable_dunnage_cost_usd` | numeric(18,2) | 0 to 999,999,999.99, "Estimated dunnage cost (USD)" |
| `tooling_markup_pct` | numeric(5,2) | 0 to 100; blank = the default (D5) |

**Pieces per bag / carton / tray reuse the existing columns**, chosen by the method's value-list entry
(`meta.countField`, so an Admin's new method says which count it uses):
- Bagged → `units_per_bag`; Carton → `units_per_case`; Tray → `units_per_tray`;
- Bulk, Other → none (pieces per pallet typed, as today).
With a method chosen, the server clears the other two counts on save (as unticking two-step clears its
details), so only that method's count is asked and `pack_out_rule` keeps working unchanged.

### `eng_cost_line` (new, a quote-item child)
`id`, timestamps, `created_by`, `quote_id` (for RLS), `quote_item_id`, `line_key` (from config), `amount_usd`
numeric(18,2) not null 0 to 999,999,999.99, `description` text ≤ 120 (required for a line with
`needsDescription`), `quantity` smallint 1 to 99 (lower blow molds for freight), `updated_by`.
Unique (`quote_item_id`, `line_key`). Blank = no row (a line sent blank is deleted). RLS as 0042 (visible
when the parent quote is; migrator all; readonly select). Fabric-safe: uuid, text, numeric(18,2), smallint,
timestamptz only. In the data dictionary (documented table).

### Config (all `provisional: true`, Admin-editable, validated by the settings registry)
- `engineering_cost_lines` (json): ordered list of `{ key, label, group: tooling | new_line, processes:
  [process codes] | "all", customerFunded, needsDescription?, prefill?: freight | start_up }`. Seed:
  - tooling: Molds (all, customer funded) · Unit mold (all; the record does not say: question for Jim) ·
    Perso parts (RHB: "two-stage molds") · Head tooling (EBM: "extrusion blow") · Freight (all, customer
    funded, prefill freight) · Start-up assistance (3 days) (all, customer funded, prefill start-up) ·
    Tariffs / duties (all, customer funded; D4) · Other (all, needs a description);
  - new line (Operations): Blow molders · Resin handling equipment · Packaging & inspection equipment ·
    Support equipment · Misc. equipment (all processes, not customer funded).
  A line shows for the item's process; with no process chosen, every line shows; **a line that holds a value
  always shows** (marked "not usual for this process"), so nothing hidden is ever in a total.
- `engineering_cost_defaults`: `{ freightCompleteMoldUsd: 1500, freightLowerBlowMoldUsd: 750,
  startUpAssistanceUsd: 5500 }`. Freight offers "Complete mold" or "Lower blow molds × n" to pre-fill, then
  stays editable; start-up pre-fills $5,500 when ticked.
- `tooling_markup_default_pct`: `0` (D5), 0 to 100.
- `offer_mold_charge_source`: `"workbook_then_engineering"` (or `"workbook_only"`).
- Value lists by data migration (`ON CONFLICT DO NOTHING`), the `value_list_list_key_check` widened:
  `pack_method` Bagged / Carton / Tray / Bulk / Other; `pallet_type` 40×48 pallet / Floor loaded (no pallet) /
  Other (floor loaded carries `meta.noPallet`).
- `offer_letter_template`: a Specifications row "Equipment / tool lead time" (`toolLeadTime` fact), by a
  guarded update that leaves an edited or approved template alone.

### Writes
All through `PUT /quotes/:qn/eng-review` (the existing route, `engReview.edit`): the new columns, plus
`costLines: [{ lineKey, amountUsd | null, description?, quantity? }]` (lines sent are upserted, a null amount
removes the line; lines not sent are untouched, so the tooling and new-line cards save independently). Same
section lock as the solution (after G2; while the engineer's part is submitted). Audit: the `eng_review`
row as today, plus one `eng_cost_line` audit row per line added, changed or removed; one
`eng_review_updated` timeline event with field names only (`costLines` when a line moved).
`units_per_pallet` is written by the server from the calculation when per layer and layers are both given.

## B. Calculations (pure domain, `packages/domain/src/engineering/cost-estimate.ts`, exact cents)
- Per item: project total = every line; customer funded = lines with `customerFunded`; net cost to Pretium
  = project total − customer funded; customer tooling price = customer funded × (1 + markup / 100), markup =
  the item's `tooling_markup_pct`, else `tooling_markup_default_pct` (0), rounded half-up to the cent. All
  in integer cents (amounts capped at 999,999,999.99; markup in basis points), so no float drift.
  Quote = the sum over items. Tests: no markup → price = customer funded; $259,000 at 15 % → $297,850.00.
- Pack-out: containers per pallet = per layer × layers; pieces per pallet = pieces per container ×
  containers per pallet; pieces per trailer = pieces per pallet × pallets per trailer. A missing input
  leaves that figure blank (never 0). Bulk / Other: pieces per trailer from the typed pieces per pallet.
  Tests: 84 × 2 × 22 → 44, 3,696; × 28 → 103,488. 256 × 4 × 5 → 20, 5,120; × 28 → 143,360.
- Labor: total per line = packers + operators (blank when both blank).
- Validators for the three settings and the cost-line set (known key, description where needed, quantity
  only for freight).

## C. Engineering tab (per item, below the solution)
The "Two-step process and pack-out" card becomes "Two-step process"; four new cards follow it:
1. **Tooling and start-up**: mold lead time; the tooling lines for the item's process (description for Other,
   Complete mold / Lower blow molds × n for Freight, a tick for Start-up); totals: Customer funded, Net cost
   to Pretium, Project total, the markup % ("Markup on customer-funded tooling (%) — leave blank for none"),
   Customer tooling price ("+ n % markup" when noted). "Leave a line blank if it is not used."
2. **New-line equipment**, collapsed by default ("Only when the quote needs a new line. Operations fills these in.").
3. **Direct labor**: packers, operators per line, total.
4. **Pack-out**: method; item number and description ("What the parts are packed in or on"); the method's
   pieces per bag / carton / tray; per layer; layers; pallet build height; pallet type; pallets per 53-ft
   trailer; special-packaging note; returnable dunnage description and estimated cost only when the KAM
   ticked returnable dunnage; calculated figures read-only (pieces per pallet read-only when calculated).
5. Beside the budgetary capital estimate: "Cost lines: project total $X · customer funded $Y · net cost to
   Pretium $Z" and **Use the project total** (fills the estimate field; saving is the normal audited edit).
   The estimate never changes on its own.
Editors as the solution (EngLead, assigned Engineer); the production scheduler reads only.

## D. Pricing and Final Review
- Quoting "From engineering": per item, lead time, cost lines with a value and the three totals plus the
  customer tooling price, labor, the pack-out and its calculated figures.
- Final Review engineering summary: lead time and the three totals per item (after FB-25 merges; else left).
- Pipeline CSV per-item rows: lead time, three totals, pieces per pallet / trailer (after FB-27 merges; cut
  line item 1).
- Offer letter: "Equipment / tool lead time" Specifications row from `mold_lead_time`; the Molds row = the
  workbook's mold charge, else the item's customer tooling price (when `offer_mold_charge_source` allows),
  else nothing; snapshotted in `offer_letter_item.mold_charge` with `mold_charge_source` (`workbook` |
  `engineering`); readiness accepts either source for "molds required". Never prints a line, a total or the rate.

## Cut line (in this order if time runs short)
1. pipeline CSV columns; 2. the letter's lead-time row; 3. the new-line card (config kept); 4. the letter's
Molds line from the customer tooling price (the price stays on Quoting). Never cut: per-item storage, the
calculations with the markup and their tests, the audit, the locks, the Quoting display.
