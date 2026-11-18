# FB-23 · Engineering cost estimate and pack-out: Jim's ECE Summary inside the Engineering tab, per item

**Run with:** Claude Code · **Opus 5.5** · **high** effort (use Fable 5.2 instead if the budget allows: it is the largest data-model change in this batch) · **Wave 2: start when FB-22 has merged** (you both edit the Engineering tab); add the Quoting and Final Review displays once FB-21 and FB-25 have merged · one draft PR · branch `claude/fb-23-engineering-cost-packout`
**Feedback items:** N18-03 to N18-10, N18-14, and Ben's decisions D4, D5 and D6 (`docs/build-guide/feedback/inputs/feedback-2026-11-17.md`, sections "Engineering cost estimate and pack-out" and "Decided by Ben") · **Tracker rows it follows:** F-024 and F-025 (two-step and pack-out for Pricing, FB-06), F-026 (the estimate workbook; `docs/build-guide/feedback/engineering-estimate-mapping.md`), FB-19 (per item)
**Promised to:** Jim Zweifel (Engineering). Ben told him on Nov 18 the changes would "probably" be ready by Friday Nov 20 and that he would ask Jim to review them.

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-21-to-27-ground-rules.md` in full.
2. Confirm FB-22 has merged into `main` (the scheduler's submit and the removed Technical concept / Supply chain boxes). If not, stop and say so.
3. **Plan first.** Commit `docs/build-guide/feedback/fb23-plan.md` before any code: the tables and columns, the config settings and their seeds, the calculations, where each figure shows, and the cut line. Record any later change of plan as a deviation.
4. **Running beside you:** FB-26 (re-quote, expiry, hand-off) and FB-27 (lists, timeline, polish). Neither edits the Engineering tab. FB-27 edits `components/attachments/*`, `QuoteTimeline.tsx` and the pipeline list (`packages/contracts/src/pipeline.ts`, `apps/api/src/services/pipeline.ts`): leave the first two alone, and for the pipeline CSV columns (Build D) rebase on FB-27 if it merged first.
5. Jim's worksheets are **not** in the repo and must not be added. Everything you need is in the record and below. Use synthetic figures in tests.

## What Jim asked for (from the record; read it there in full)
Jim's group fills in the **ECE Summary** after reading the ERF, one column per size (item). Pricing (Gemma Cebolla's team) needs it to price. Jim said efficiency and output per hour are already on Faron's capacity page: **do not add a run-rate block, an OEE figure or an OEE default** (D-08 stands).
- **Estimated mold lead time** (free text such as "16-18 weeks").
- **Tooling cost lines** (USD, optional; blank or $0 = not used): Molds, Unit mold, Perso parts, Head tooling, Freight, Start-up assistance (3 days), Other (with a description). Different processes use different lines: single-stage tools, two-stage molds (perso parts), extrusion blow (head tooling).
- **Standard figures:** freight $1,500 for a complete mold, $750 for each lower blow mold; start-up assistance $5,500 for 3 days. Freight must stay editable (air freight from Japan was about $40,000).
- **Customer funded** = Molds + Freight + Start-up on the sheet. **Project total** = every line. **Net cost to Pretium** = project total − customer funded.
- **New-line capital equipment** (optional; Operations, not Jim's group, would fill these, and Paul Slomkowski and Kal Kaliszewski may want them split differently): Blow molders, Resin handling equipment, Packaging & inspection equipment, Support equipment, Misc. equipment.
- **Direct labor:** packers and operators per line, fractional (0.68 packers means one packer covers more than one line).
- **Pack-out:** method (bagged or carton; a carton has a liner against cardboard dust), the item number and description of what the parts go in or on, pieces per bag or carton, bags or cartons per layer, layers per pallet, pallet build height, 40×48 pallet or floor loaded (floor loaded = no pallet cost), pallets per 53-ft trailer; calculated: bags or cartons per pallet, pieces per pallet, pieces per trailer. Examples to use as test cases: 84 per bag × 2 per layer × 22 layers = 44 bags, 3,696 pieces per pallet; × 28 pallets = **103,488** per trailer. 256 per carton × 4 per layer × 5 layers = 20 cartons, 5,120 per pallet; × 28 = **143,360** per trailer.

## Ben's decisions (2026-11-18; record "Decided by Ben"; build to these, provisional until Bailey confirms)
- **D4. Extra cost inputs, all optional, on the Engineering tab:** a **"Tariffs / duties"** tooling line (Jim raised tariffs with mold and freight costs; seed it customer funded, like the other tooling Jim says is passed on); a **special-packaging note** in the pack-out (Faron: special packaging that needs floor loading; floor loaded is already a pallet type below); **returnable dunnage** details in the pack-out, shown when the KAM ticked returnable dunnage at intake (Faron, Gemma). The stocking agreement is FB-24's (intake).
- **D5. A tooling markup only when someone notes one.** Jim's offer letter form marks the customer-funded total up by about 15 %; Ben decided (2026-11-18) there is **no markup unless it is noted on the quote**: customer tooling price = customer-funded total × (1 + markup %), with the markup **0 % by default**.
- **D6. Container item numbers are free text** for now (no list).

## What the code does today (read 2026-11-18 at `f017ccc`; verify before relying on it)
- **Per item:** `eng_review` has one row per `quote_item` (FB-19); capacity rows likewise. Engineering is assigned once per quote.
- **Pack-out today** (`eng_review`, `packages/db/src/schema/workflow.ts` ~1418-1440): `units_per_bag`, `units_per_tray`, `units_per_case`, `units_per_pallet`, integers 1–9,999,999 (check `eng_review_pack_out_check`); contract `PackOutCount` (`packages/contracts/src/eng-review.ts` ~21). Rule setting `pack_out_rule` (`notTogether: [bag, case]`, `requireOneOf` seeded false; `packages/domain/src/engineering/pack-out.ts` ~21-31). Two-step: `two_step`, `preform_plant_code`, `blow_plant_code`, `preform_number`, `two_step_freight_note`.
- **No cost, lead-time, labor or pallet fields** exist anywhere (searched `mold_cost|tooling_cost|lead_time|freight`; the only freight columns are the intake's `freight_type` and `freight_special_arrangements` and the two-step freight note).
- **Budgetary capital estimate** `eng_review.prelim_capital_usd` drives "capital needed" (above `capital_needed_above_usd`, seed 0), the equipment BOM requirement at G2, the priority score's capital factor, and (after FB-21) capital readiness "pending".
- **Equipment BOM** is a versioned upload (`equipment_bom`); nothing is read from it.
- **Shown to Pricing** through `EngineeringInputsCard` ("From engineering", `apps/web/src/components/engineering/EngineeringExtras.tsx` ~622-639) on the Quoting tab; Final Review has its own engineering summary (`components/final-review/ReviewScreen.tsx`).
- **Offer letter** (FB-20): a Specifications table built from each item's facts with labels in `app_setting.offer_letter_template`; rows no item has are omitted.

## Build

### A. Data model (one migration)
1. **Per item on `eng_review`:** `mold_lead_time` text (≤ 40), `packers_per_line` and `operators_per_line` `numeric(6,2)` (0–99.99), and the pack-out columns: `pack_method` (value list `pack_method`: Bagged, Carton, Tray, Bulk, Other; provisional), `pack_container_item_no` text (≤ 40), `pack_container_description` text (≤ 120), `containers_per_layer` and `layers_per_pallet` integers, `pallet_build_height` text (≤ 20, the unit typed in, e.g. "96 in"; the sheet's unit is unconfirmed), `pallet_type` (value list `pallet_type`: 40×48 pallet, Floor loaded (no pallet), Other; provisional), `pallets_per_trailer` integer (53-ft trailer), and for D4 `special_packaging_note` text (≤ 300), `returnable_dunnage_description` text (≤ 200) and `returnable_dunnage_cost_usd` `numeric(18,2)` (the estimated dunnage cost; ask Gemma whether it is per trip or one-time and label it "Estimated dunnage cost (USD)" until then). **Reuse** `units_per_bag` / `units_per_case` / `units_per_tray` for "pieces per bag / carton / tray" according to the method, so the existing readers keep working; say in the plan which method writes which column.
2. **Cost lines:** a quote-item child table `eng_cost_line` (RLS as `0042_fb14_model_summary.sql`): `quote_item_id`, `line_key` (from config), `amount_usd` `numeric(18,2)` ≥ 0, `description` text (≤ 120, required for "other"), `quantity` smallint (for per-mold freight), timestamps, `updated_by`. One row per (item, line_key). Blank = no row. Fabric-safe; data dictionary.
3. **Config (provisional, Admin-editable without a deploy, validated, `provisional: true`):**
   - `engineering_cost_lines`: the ordered list of lines, each `{ key, label, group: "tooling" | "new_line", processes: [process codes] | "all", customerFunded: boolean, needsDescription?: boolean }`. Seed the eleven lines above plus **"Tariffs / duties"** (tooling, all processes; D4). **Which processes show which line** (unit mold, perso parts, head tooling): map from the process codes FB-16 derives (`machine_type_process_map`); where the record does not say, show the line for every process and list it as a question for Jim. Seed `customerFunded: true` for Molds, Freight and Start-up (as the sheet) and for Tariffs / duties (D4); every other line false.
   - `tooling_markup_default_pct`: `0` (D5; validated 0–100). A per-item, optional `tooling_markup_pct` `numeric(5,2)` on `eng_review` (blank = the default) is where a markup is "noted": entered with the tooling lines, labelled "Markup on customer-funded tooling (%) — leave blank for none", audited like the other fields.
   - `engineering_cost_defaults`: `{ "freightCompleteMoldUsd": 1500, "freightLowerBlowMoldUsd": 750, "startUpAssistanceUsd": 5500 }`. Freight offers "Complete mold" or "Lower blow molds × <n>" to pre-fill, then stays editable. Start-up pre-fills $5,500 when ticked.
   - the two new value lists, by data migration (`ON CONFLICT DO NOTHING`, as `0044`).
4. Write every change through the engineering service with audit rows and an `eng_review_updated` timeline event (field names only, as today). Changes are locked by the same section lock as the solution (after G2, and while the engineer's part is submitted, FB-22).

### B. Calculations (pure domain, `packages/domain/src/engineering/`, 100 % unit-tested, exact decimals)
- **Cost totals per item:** project total, customer funded (lines with `customerFunded`), net cost to Pretium, and the **customer tooling price** = customer funded × (1 + `tooling_markup_pct` / 100), with the markup being the item's noted `tooling_markup_pct`, else `tooling_markup_default_pct` (0), rounded to the cent (D5); and for the quote, the sum over items. Tests: no markup noted → the price equals the customer-funded total; a $259,000 total with 15 % noted → $297,850.00.
- **Pack-out per item:** containers per pallet = per layer × layers; pieces per pallet = pieces per container × containers per pallet; pieces per trailer = pieces per pallet × pallets per trailer. Missing input → that figure is blank, never 0. Jim's two examples are tests. When `containers_per_layer` and `layers_per_pallet` are both given, the server writes `units_per_pallet` from the calculation (it becomes read-only in the form); otherwise it stays as typed. Keep `pack_out_rule` working; with a method chosen, only that method's count is asked.
- **Labor:** total per line = packers + operators.

### C. The Engineering tab (per item, below the solution)
1. **Tooling and start-up** card: mold lead time, then the tooling lines for this item's process, each with an amount (and description for Other; quantity for lower blow molds), then the totals: "Customer funded", "Net cost to Pretium", "Project total", the optional markup %, and "Customer tooling price" (equal to customer funded when no markup is noted; when one is, the line says "+ <n> % markup"). A short note: "Leave a line blank if it is not used."
2. **New-line equipment** card, collapsed by default ("Only when the quote needs a new line. Operations fills these in."), the five lines.
3. **Direct labor** (packers, operators per line, total).
4. **Pack-out** card replacing today's pack-out inputs: method, item number and description ("What the parts are packed in or on"), pieces per bag / carton / tray, per layer, layers, pallet build height, pallet or floor loaded, pallets per 53-ft trailer, a special-packaging note, and (only when the KAM ticked returnable dunnage at intake) the dunnage description and estimated cost, with the calculated figures shown read-only. Label the block "Pack-out" (Jim left the bag / tray / carton wording to Ben; ask).
5. **The budgetary capital estimate is not changed automatically.** Beside it, show "Cost lines: project total $X · customer funded $Y · net cost to Pretium $Z" and a **Use the project total** button that fills the estimate (audited like any edit). Whether the estimate should be the project total or the net cost is a question for Bailey (it changes "capital needed" and the priority score).
6. Who edits: as the solution today (EngLead, and the assigned Engineer); the production scheduler does not. The new-line card follows the same rule (Operations has no role yet: say so in "Waiting on").

### D. Where Pricing and Final Review see it
- **Quoting** "From engineering" (after FB-21's reorder): per item, the lead time, the cost lines that have a value with the three totals, labor, and the pack-out with its calculated figures.
- **Final Review** engineering summary: the lead time and the three totals per item.
- **Pipeline CSV, per-item rows** (FB-19's "One row per item option"): add the lead time, the three totals and pieces per pallet / per trailer.
- **Offer letter** (wording still unapproved):
  - an optional Specifications row "Equipment / tool lead time" from `mold_lead_time`, omitted when empty, seeded in `offer_letter_template` by guarded data migration;
  - **the Molds line (D5):** FB-20 reads `offer_mold_charge` from the costing workbook, and the seeded map has no mold cell, so today no letter can print molds. Add a setting `offer_mold_charge_source` (provisional, seed `"workbook_then_engineering"`): use the workbook's mold charge for an item when it has one, otherwise that item's **customer tooling price** (D5), otherwise nothing. Snapshot the figure in `offer_letter_item.mold_charge` as FB-20 does, and record the source on the letter (a `mold_charge_source` text column). Update FB-20's readiness so a customer-paid or shared quote can satisfy "molds required" from either source. Read `packages/domain/src/offer-letter` first.
  - **Rule 5 note for the PR:** CLAUDE.md says pricing figures are not edited in CCQ. This figure is not typed in: it is derived from Engineering's cost lines and a config rate, because Ben decided the letter should match Jim's offer letter form. Say this in the PR and put it to Gemma Cebolla (question 4 below). Never print an individual cost line, the totals or the rate on the letter.

### E. Docs
Update `engineering-estimate-mapping.md`: the ECE Summary lines now have fields; what is still only in the BOM upload; that the run-rate block is covered by capacity evidence.

### Cut line if time runs short
Drop in this order: (1) the pipeline CSV columns; (2) the offer letter's lead-time row; (3) the new-line equipment card (keep its config); (4) the letter's Molds line from the customer tooling price (keep the price on the Quoting tab). Never drop: per-item storage, the calculations (with the markup) and their tests, the audit, the locks, the Quoting display.

## Tests
Domain: every total and pack-out figure (both examples, floor loaded, missing inputs), the line filter by process, the config validators. DB: the migration on a seeded and an empty database; RLS on `eng_cost_line`; Fabric guards. API integration: save and read lines per item on a three-item synthetic quote; locks after G2; permission matrix for every role (Engineer assigned / not, ProductionScheduler denied, EngLead, others). Playwright: an engineer enters tooling lines, labor and a bagged pack-out on item 1 and a carton pack-out on item 2, sees the calculated figures, and the pricer sees them on the Quoting tab. 1366 × 768 and 390 px, both themes.

## Questions for Jim, Bailey and Operations (draft them; send nothing)
1. **Jim:** which process codes use unit mold, perso parts and head tooling? What does "Perso parts" stand for? What unit is pallet build height in? Is "Pack-out" the right heading?
2. **Bailey:** should the budgetary capital estimate be the project total or the net cost to Pretium (open decision 18)? Are the D4 placements right (tariffs on Engineering's tooling lines, special packaging and returnable dunnage in Engineering's pack-out)?
3. **Paul Slomkowski / Kal Kaliszewski:** the new-line equipment lines: right split? Who enters them, and should they get a role?
4. **Gemma Cebolla:** when a markup is noted, should it apply to the whole customer-funded total (molds, freight, start-up, tariffs) as Jim's form does? Who should note it, Engineering or Pricing (built: Engineering, with the tooling lines)? Should the offer letter's Molds line come from this figure when the costing workbook has none? Is the returnable dunnage cost per trip or one-time?

## Done when
- [ ] `fb23-plan.md` committed first; deviations recorded
- [ ] per-item lead time, labor, pack-out, special-packaging and dunnage columns; `eng_cost_line` with RLS; the settings (`engineering_cost_lines` with Tariffs / duties, `engineering_cost_defaults`, `tooling_markup_default_pct` (0), `offer_mold_charge_source`) and the per-item `tooling_markup_pct` and two value lists; migration tested on seeded and empty databases; Fabric guards pass
- [ ] the customer tooling price (D5: no markup unless noted) calculated, shown, and used for the letter's Molds line when the workbook has none, with its source recorded
- [ ] calculations in the domain with Jim's examples as tests
- [ ] the four Engineering cards per item; the estimate untouched with "Use the project total"
- [ ] shown on Quoting and Final Review; the CSV columns and the letter row (or listed as cut)
- [ ] tests as listed; `pnpm verify` passes; close-out done (ground rules), including a note in the PR that Ben promised Jim a look
