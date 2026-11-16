# FB-19 plan: multi-item quotes

Written before any code (FB-19 prompt, "Plan first, then build"). Base: `main` at 62f62dd (FB-15 to FB-18 merged: PRs #98, #99, #100, #101). The last migration is `0046_fb17_gate_decisions_holds`, so this step is **0047** (`0047_fb19_multi_item_quotes`). Any change of plan while building is recorded as a deviation in `03-build-steps.md`.

## 1. The table: `quote_item`

A quote child, one row per item. `item_no` is 1…n with no gaps (unique per quote, renumbered after a removal or a reorder). Item 1 is the **primary item**.

| Column | Type | Note |
|---|---|---|
| `id` | uuid v7 | Primary key (server-generated) |
| `quote_id` | uuid FK → `quote` | |
| `item_no` | smallint | 1…n, `unique (quote_id, item_no)`, CHECK ≥ 1 |
| `label` | text | The KAM's short name ("16 oz bottle"), ≤ 60 (CHECK) |
| product columns | as on `quote` today | Same types and CHECKs (dimensions > 0, print colors 1–12) |
| `container_size` | text | A real column (on `quote` it lives only in `structured_description.size`) |
| `standard_description` | text | On `quote` it lives in `structured_description.standard` |
| `sf_product_spec_id` | text | The Salesforce product specification the item came from |
| `created_at`, `updated_at`, `created_by` | | `baseColumns()` |

Product columns (decision 3): `product_family`, `product_family_other`, `components` (text[]), `component_other`, `liner_spec`, `labels_purchased_by`, `decoration_type`, `decoration_type_other`, `decoration_print_colors`, `resin`, `resin_customer_specified`, `resin_grade`, `pcr_level`, `pcr_level_other`, `color_type`, `color_description`, `additive`, `additives`, the six neck columns, `container_size`, `height_mm`, `width_or_diameter_mm`, `depth_mm`, `gram_weight_g`, `modify_existing_mold`, `existing_mold_ref`, `mold_change_description`, `packaging_type`, `packaging_notes`, `drawing_status`, `est_annual_volume`, `est_annual_volume_confirmed`, `product_needed_by`, `standard_description`, `sf_product_spec_id`.

- **Fabric:** `components` is an array, so it gets `components_json` (registered in `packages/db/src/fabric.ts`, trigger argument, backfill). Numerics are `numeric(10,2)`.
- **RLS:** the three policies of 0042 (`quote_item_app` via `EXISTS (SELECT 1 FROM quote q WHERE q.id = quote_item.quote_id)`, `_migrator`, `_readonly`), enabled and forced.
- **Setting:** `quote_items_max` (provisional, 20). Enforced on the server (draft save and submit) and in the wizard.

## 2. Which columns move, and the `quote` mirror (decision 6)

No column is dropped from `quote`. The product columns stay on `quote` as a **mirror**: on every submit and resubmit (the only times items change), the server writes item 1's product columns to `quote` (`structured_description.size` / `.standard` too), `est_annual_volume` = the **sum** of the items' volumes, and `est_annual_volume_confirmed` = true only if every item's is. New code reads items; scoring, routing, lists, analytics and the Fabric views keep reading `quote` unchanged. The column comments and `01-architecture.md` §5 say so.

Request-level fields (decision 2) stay where they are on `quote`. The free-text `description` and `quote_variants_note` are request level.

## 3. Engineering per item

- **`eng_review`** gets `quote_item_id` (FK, NOT NULL after backfill); the unique `quote_id` is replaced by unique `quote_item_id` (`quote_id` stays as a plain FK, indexed).
- **Quote-level engineering fields stay on item 1's row** (the simplest option the prompt allows): acceptance (`accepted_at/by`), the capacity sign-off (`capacity_signoff_*`) and `capacity_ready_at`. `getEngReview(db, quoteId)` returns the primary item's row, so every reader of those fields is unchanged. Writes of them go to the primary row. When the primary item changes (item 1 removed or reordered at a rework), the item sync moves those fields to the new item 1's row in the same transaction. Item-level fields (the solution, two-step, pack-out, capital) are per row.
- **Every join of `eng_review` on the quote** joins the primary item's row (`eng_review.quote_item_id = (select id from quote_item where quote_id = quote.id and item_no = 1)`) or aggregates (capital: sum), each tested with a 3-item quote: `quote-read.ts`, `pricing.ts`, `pipeline.ts`, `records.ts`, `transitions.ts`, `admin-config.ts`, `engineering.ts`, `scoring.ts`, `fb09Report.ts`, `analytics-engineering.ts`.
- **`capacity_evidence`** gets `quote_item_id` (FK, NOT NULL after backfill). `allocationCheck` compares each item's rows with that item's volume.
- **Removing an item that Engineering has worked** (rework only): its `eng_review` and `capacity_evidence` rows are deleted, each with an audit row holding the full before-image (the audit keeps the work).

## 4. Migration of existing quotes (0047)

1. Create `quote_item` (+ RLS, companion, trigger).
2. Insert item 1 for every quote that has none, from its columns (`container_size` from `structured_description->>'size'`, `standard_description` from `->>'standard'`, `label` from the container size and product family label where there is one).
3. Add `quote_item_id` to `eng_review` and `capacity_evidence`, point every row at its quote's item 1, set NOT NULL, swap the unique index.
4. Add nullable `quote_item_id` to `attachment` (no FK: on a draft it holds the draft item's key, see §6); set it to item 1 for the existing drawing kinds (`bottle_drawing`, `spec`, `competitor_drawing`) on quotes.
5. Backfill every draft's `data` with `items: [item]` built from its flat product fields (and remove those keys from the top level). Drafts are read either way: a draft with no `items` is read as one item from its flat fields.
6. Settings `quote_items_max` (20) and `opportunity_active_quotes` (`warn`), and the warning message, provisional, `ON CONFLICT DO NOTHING`.
7. Drop `quote_one_active_per_opportunity_uidx` (last, after the service check below is in place).

Idempotent (every step guarded by `IF NOT EXISTS` / `WHERE NOT EXISTS`), a no-op on an empty database; `packages/db/test/fb19-migration.int.test.ts` runs it on a copy of the seeded database (pre-0047 state rebuilt), twice.

## 5. One active quote per opportunity → a setting

`opportunity_active_quotes`: `one` | `warn` (provisional, seed `warn`).
- At submit (new quote only) the server takes `pg_advisory_xact_lock(<namespace>, hashtext(sf_opportunity_id))` in the submit transaction, then reads the opportunity's active quotes in **system context** (so another KAM's quote counts; only the quote number and the KAM's name come back). With `one`: 409 `active_quote_exists` as today. With `warn`: 409 unless the draft records that the KAM confirmed a separate quote (`separateQuoteConfirmed`), in which case the submit goes ahead and the audit row names the open quote(s). Concurrent submits serialise on the lock, so the index is no longer needed and is dropped.
- *Deviation from the prompt's wording:* `withAdvisoryLock` is a session-level try-lock on its own connection (built for jobs); the submit needs a transaction-scoped lock that waits, so it uses `pg_advisory_xact_lock` in the same transaction (released at commit).
- The picker and the draft show "CCQ-… is already open for this opportunity (KAM: <name>). …" with the KAM's confirm; `listActiveQuotesForOpportunities` returns several.
- The B-07 RLS test that asserted the index is replaced by API integration tests (`one` → 409, `warn` unconfirmed → 409, `warn` confirmed → created, another KAM's quote counts, two concurrent submits → one wins under `one`).

## 6. Intake

- **Draft shape:** `IntakeDraftData.items: IntakeItemData[]` (≤ `quote_items_max`): `key` (a client uuid; the quote item id once the quote exists), `label`, every decision-3 field, `sfProductSpecId`, and `linkedDrawingIds` (drawings a duplicate shares with the item it was copied from).
- **Wizard (deviation: no fifth numbered step).** The draft keeps its four steps (`quote_draft.step` is CHECKed 1–4 and drafts resume by step number). Step 3 becomes **"Request & items"**: the request fields once, then the **Items** panel (number, label, product family, size, volume, need-by, ✓ or "n to do"), with Add item, Add from Salesforce products, Duplicate, Remove (confirm; one always stays) and Move up / down. The selected item's product fields show below the list (the existing product fields, unchanged for a one-item quote). Step 4's drawing uploads ask which item when there is more than one.
- **Validation:** `evaluateIntake` runs the request rules once and the product rules per item (the configured `intake_required_fields` rules are split by the fields they read: a rule that reads an item field runs per item against the request values plus the item's). Messages name the item ("Item 2 (16 oz bottle): …") only when there is more than one item; each issue carries `item` (its number) so the Fix link opens that item's field. Drawing-or-minimum-spec is per item with the item's own drawings (attachments with that `quote_item_id`, plus `linkedDrawingIds`); a drawing with no item (older files) counts for item 1.
- **Submit:** the server creates / updates / deletes `quote_item` rows to match the draft (ids are server-generated; draft attachments are re-keyed from the draft item's key to the new id; linked drawings become linked attachment rows sharing the stored file, and removing one row moves the file only when no other live row shares it), renumbers, writes the mirror, and audits every add, change, duplicate and remove (`quote_item` audit rows with before / after).
- **Rework:** the rework draft's items are rebuilt from the quote's `quote_item` rows. Removing an item that has engineering work asks for confirmation and discards that work at resubmit (audited).

## 7. Gates read items

- `loadQuoteStates` adds `fields.items` (one entry per item: `item_no`, `label`, `est_annual_volume`, the item's `eng_review` item-level columns, its `capacity_evidence` rows and `capacity_utilization_missing`). The quote-level fields are unchanged (the mirror and item 1's review row), so a one-item quote evaluates exactly as before.
- One domain evaluator, `evaluateQuoteRules(rules, fields)`, replaces `evaluateRules` for gate decisions, the `missing` lists and submit-to-lead: **a rule that reads a field the item facts carry runs once per item** against the quote's facts plus that item's; every other rule runs once. Nothing names G2 or a field: which rules are per item follows from the config and the facts the state builder puts on items. Failures name the item when there is more than one. The gate passes only when every item passes.
- `eng_capital_needed` is derived per item; the quote-level value is true when any item's is. Scoring's capital is the sum of the items' preliminary capital.

## 8. Downstream

Scoring reads the mirror (breakdown says "3 items, 2.1 M units a year in total"). Quoting, Final Review, the review summary, G6 hand-off, the quote page, pipeline, board, search and CSV exports show the item count and item 1's label ("16 oz bottle + 2 more"); the pipeline CSV can add one row per item. New view `analytics_quote_item` (no customer data) with its T-SQL twin.

## 9. Cut line

If everything cannot land: ship A, B and D with Engineering reading item 1 only and the Engineering tab saying "Engineering for items 2 and later comes in the next update"; under the cut line G2 Advance / Advance with risk is refused for a quote with more than one item (Hold, Send back to… and Stop still work); C follows in a same-day PR. The plan is to build all of it in this PR.
