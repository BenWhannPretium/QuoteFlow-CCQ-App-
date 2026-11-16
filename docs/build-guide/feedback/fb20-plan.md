# FB-20 plan: the offer letter

Written before any code (FB-20 prompt, "Plan first, then build"). Base: `main` at `8950c2a` (FB-19 merged in PR #103, the FB-20 prompt in PR #104). FB-19 (`quote_item`, `0047_fb19_multi_item_quotes`) and FB-14 (`packages/domain/src/model-summary`, `apps/api/src/services/model-summary.ts`) are both on `main`, so the stop check passes. The last migration is `0047`, so this step is **0048** (`0048_fb20_offer_letter`). Any change of plan while building is recorded as a deviation in `03-build-steps.md`.

The old Standard Quote Template was read from outside the repo. Its labels and wording are in [`inputs/offer-letter-template-structure.md`](inputs/offer-letter-template-structure.md); the file itself is not committed. It names real sales staff in its signer drop-down: none of those names is copied anywhere.

## 1. Tables (migration 0048, additive)

### `offer_letter` (quote child, one row per generated letter, insert-only)

| Column | Type | Note |
|---|---|---|
| `id` | uuid v7 | |
| `quote_id` | uuid FK → `quote` | |
| `quote_version` | integer | `quote.version` when generated (a re-quote makes the letter **Superseded**) |
| `letter_no` | smallint | 1…n per quote, `unique (quote_id, letter_no)`, CHECK ≥ 1 |
| `attachment_id` | uuid FK → `attachment` | The stored `.docx` (kind `offer_letter`), unique |
| `template_version` | text | `offer_letter_template.templateVersion` at generation |
| `wording_approved` | boolean | `offer_letter_wording_approved` at generation |
| `letter_date` | date | The proposal-issued date (US Central) |
| `attention` | text | ≤ 120 (CHECK), typed by the KAM, nullable |
| `valid_until` | date | `quote.validity_until` at generation |
| `cost_model_attachment_id` | uuid FK → `attachment` | The workbook the prices were read from |
| `cost_model_version` | integer | Its version |
| `generated_by` | uuid FK → `app_user` | |
| `generated_at` | timestamptz | |
| `created_at`, `updated_at`, `created_by` | | `baseColumns()` |

### `offer_letter_item` (one row per item on a letter, insert-only)

| Column | Type | Note |
|---|---|---|
| `id`, `offer_letter_id` (FK), `quote_id` (for RLS) | | |
| `quote_item_id` | uuid FK → `quote_item`, nullable | Null only for a pre-FB-19 quote listed from its own columns |
| `item_no` | smallint | CHECK ≥ 1, `unique (offer_letter_id, item_no)` |
| `part_description` | text | Label + standard description, as printed |
| `part_number` | text | ≤ 60 (CHECK), typed by the KAM, nullable |
| `place_of_manufacture` | text | The plant label, as printed |
| `annual_volume` | integer | As printed |
| `piece_price_per_1000`, `mold_charge`, `change_parts_charge` | numeric(18,4) | **Snapshotted**; null when not on the letter |

- **RLS:** the three policies of `0042` on both tables (`_app` through the parent quote, `_migrator`, `_readonly`), enabled and forced. `REVOKE UPDATE, DELETE, TRUNCATE … FROM ccq_app`: a letter is what was sent.
- **Fabric (rule 10):** uuid, text, smallint, integer, boolean, date, timestamptz and numeric(18,4) only: no companion, no view, so no T-SQL twin. `pnpm db:dictionary` regenerated.
- **Attachment kind `offer_letter`:** added to `ATTACHMENT_KINDS`, the contracts list and label, and `attachment_kind_check`. Format `.docx` only (`KIND_FORMATS`). It is **not** a versioned kind (`version` stays null, so `attachment_version_check` is unchanged): the letter number is the version. It is **generated, never uploaded**: the upload route refuses the kind. Download, audit and data scope are the existing attachment download route.

## 2. Prices from the costing workbook (extends FB-14)

- `modelSummaryFieldSchema` gets `itemNo` (optional, 1–50, null = the whole quote). Field keys must be unique per `(key, itemNo)`.
- Two units: `usd_per_unit`, `usd_per_1000`. Three offer keys any costing map may carry per item: `offer_piece_price`, `offer_mold_charge`, `offer_change_parts_charge`. The validator requires an offer key to be a `number` field in one of the two price units, and `offer_*` keys only on `cost_model` maps.
- `model_summary_field.item_no smallint` (nullable, CHECK ≥ 1); the unit CHECK gains the two units.
- **Deviation (planned):** `model_summary_field.value_number` widens from `numeric(18,4)` to `numeric(24,10)` (Fabric-safe: precision ≤ 38). A per-unit piece price such as 0.08253 needs more than four decimals or the per-1,000 price is wrong by up to 5 cents per thousand. The 1e14 range guard is unchanged (14 integer digits either way).
- `toPer1000(value, unit)` in the domain: exact decimal arithmetic on scaled `bigint` (no floating point), result `numeric(18,4)` as a string, half-up. `0.0825 usd_per_unit → "82.5000"`.
- **Seed:** the **inactive** `erf_costing_pre_makeover` map gains `offer_piece_price` for item 1, `Summary!B16` (the target-price candidate cell in `costing-template-structure.md`), unit `usd_per_unit`, **proposed** (Gemma Cebolla to confirm the unit). No mold or change-parts field (no candidate cell). The map stays `active: false`. Existing environments get the field through a data migration that skips the setting when it was approved or edited (`approved_at` set or `version` > 1).
- The letter reads the **current** `cost_model` version's summary, only when its status is `complete` and `model_summary_visible` is on.
- A synthetic three-variant costing workbook (ExcelJS, one column per item) with a map active **in the test only** proves it.

## 3. The letter

### Domain (`packages/domain/src/offer-letter/`, pure)
- `config.ts`: `app_setting.offer_letter_template` schema and seed (provisional, `legalApproved: false`), the token whitelist (`{{quoteNumber}}`, `{{customerName}}`, `{{validUntil}}`, `{{paymentTerms}}`, `{{priceBasis}}`, `{{freight}}`, `{{toolingFunding}}`, `{{moldOwnership}}`; an unknown token makes the setting invalid), `parseOfferLetterWordingApproved`, `parseOfferLetterBlockIfCostingChanged`.
- `money.ts`: `toPer1000`, `formatUsd` (`$#,##0.00`).
- `readiness.ts`: `evaluateOfferReadiness(facts, config)` → `{ canGenerate, blockers[], warnings[] }`, each with a code, a plain sentence and where it is fixed.
  - Blockers: not in Customer Decision; on hold; no `proposal_issued_at` / `validity_until`; no costing workbook / summary not complete / figures hidden; an item without `offer_piece_price`; a required row missing (piece price **always**, molds when tooling funding is `CUSTOMER_FUNDED`, `ZERO_CER` or `SHARED`, change parts never; all config); an item with no plant; a `cost_model` uploaded after the latest G4 Approve (`offer_letter_block_if_costing_changed`, seeded on).
  - Warnings: wording not approved by Legal; no Attention; an item without a Part #.
- `model.ts`: `buildOfferLetterModel(facts, inputs, config)` → plain data (header lines, items, pricing rows, the columns to print, specifications, assumptions with tokens substituted, closing). Optional rows with no value are omitted; a column no item has is omitted; a sentence whose token has no value on the quote is dropped.

### Config (`app_setting`, provisional, Admin-editable, validated by the console)
- `offer_letter_template`: `templateVersion`, title, introduction, closing, sign-off, the pricing-assumptions list (one level of sub-points), the row labels and `required` rules, the specification rows (labels over a fixed list of item facts), `showValidity`, the footer note, and `legalEntity` / `address` (blank until Legal gives them). Seeded from the old template's text; every change is a deviation (listed in the structure note).
- `offer_letter_wording_approved`: **false** (Legal's sign-off).
- `offer_letter_block_if_costing_changed`: **true**.

### Field sources (none is typed except the two marked)

| Letter field | Source |
|---|---|
| To | `customer.name` (the Salesforce Account on the quote) |
| Attention | **typed by the KAM** on the generate screen |
| Date | `proposal_issued_at`, US Central calendar date |
| Valid until | `validity_until` (when `showValidity`) |
| Quote # | `quote_number` (`CCQ-YYYY-NNNNN`) |
| Part description | the item's label, container size and standard description |
| Part # | **typed by the KAM per item** (no field is added to intake) |
| Place of manufacture | the item's `eng_review.plant_code` → `plant` value-list label |
| Estimated annual volume | the item's `est_annual_volume` |
| Piece price per 1,000 / Molds / Change parts | the current costing summary's `offer_*` fields for the item, converted to per 1,000 |
| Specifications (old "Other Assumptions") | the item's resin, colour, cavitation, gram weight, neck finish, decoration and packaging (value-list labels); rows with no value are omitted |
| Pricing assumptions | config sentences plus tokens (payment terms, price basis, freight, tooling funding, mold ownership: value-list labels) |
| Signed | the quote's KAM (`app_user.display_name`), "Pretium Packaging" |

### Renderer (`apps/api/src/documents/`)
- `brand.ts`: every colour, font, size and spacing token in one place, from the Pretium design system (1.5.2): Pretium Green `#225651`, Copper `#C05131` (the DRAFT line and eyebrows), green tints, Body Gray `#454545`. Fonts: the system's `.docx` fallbacks, **Georgia** for display (Value Serif Pro is not on a standard Word install, and the brand fonts are for internal outputs) and **Arial** for body (Basis Grotesque Pro likewise).
- `offer-letter-docx.ts`: model → `Buffer` with `docx` (MIT, pure JS, pinned **9.15.1**, published 2026-10-31). US Letter, Word-editable. The current primary logo (full colour) top left in the header, the DRAFT line top right while unapproved, a green hairline; a title block; a details panel; items, pricing and specification tables (green header row, light banding, numbers right-aligned); the assumptions as a list; the sign-off; footer with the legal entity (when set), the confidentiality note and `Page X of Y`.
- Logo: `apps/api/assets/brand/pretium-primary-fullcolor.png` (copied from the design system's approved logos), shipped to `dist/assets` by tsup.

### Permissions (provisional; confirm with Bailey)
- `offer.read`: every role that reads the quote (the `quote.read` grants, PostAward on Awarded quotes).
- `offer.generate`: KAM on **own** quotes, SalesLeader, Pricing, PricingLead, Admin.
- `matrix.ts`, `01-architecture.md` §3.4, `docs/security/route-inventory.md`, the permission registry.

### Routes (`/api/v1/quotes/:quoteNumber/offer-letter`, OpenAPI)
- `GET` (`offer.read`): readiness, the prefilled model, the price source ("Read from <file> v<n>, uploaded by <name> on <date>"), the earlier letters (Superseded when `quote_version` differs), `canGenerate` for the caller.
- `POST` (`offer.generate`): `{ attention, items: [{ itemId, partNumber }], acknowledgedWarnings }`. One transaction: lock the quote row (`FOR UPDATE`), re-evaluate readiness, refuse unacknowledged warnings (409), snapshot, render, store the file, insert the attachment, `offer_letter`, `offer_letter_item`, the `offer_letter.generated` audit event (letter id, quote version, item count, template version, `wording_approved`, the costing file and version; no prices, no customer text) and the `offer_letter_generated` timeline event. If the transaction fails the stored file is moved to the removed folder. The lock serialises a concurrent double POST into letters 1 and 2.
- Download: the existing `GET /attachments/:id/download`.

## 4. Screens
- `CustomerDecision.tsx` → an **Offer letter** card: *Not available yet* (before Final Review), *Cannot generate* (each blocker, with a link to where it is fixed), *Ready* (the generate form), and the earlier letters (number, date, who, Superseded, Download).
- Generate form: Attention, Part # per item, the read-only table of what will print with "Read from <file> v<n>. Figures come from the workbook and cannot be edited here.", the assumptions, the warnings to tick, **Generate Word document** (then the download starts and the list refreshes).
- My proposals: a link to the card on each proposal.
- 390 px, light and dark, axe.

## 5. Tests
- Domain: readiness (each blocker and warning), `toPer1000`, tokens (dropped sentence, unknown token rejected), the model for one and three items, the per-item model-summary fields.
- Renderer: unzip the `.docx` and assert text, prices, DRAFT on/off, escaping, `PK` header, no `undefined` / `NaN` / `{{`.
- API integration (real Postgres): the full matrix of refusals in the prompt, letters 1 and 2, Superseded after a re-quote, snapshot stability, audit without prices, concurrent POSTs.
- Permission matrix: both routes × every role, allowed and denied.
- Playwright: generate on an approved three-item quote; "Not available yet" before Final Review.
- Migration test on a seeded and an empty database.

## 6. Cut line
Drop in this order if time runs short: (1) the My proposals link; (2) multi-item tables; (3) Superseded labelling. Never dropped: the Final Review gate, the server-side readiness check, snapshotting, escaping, the audit, the permission tests, the DRAFT flag.
