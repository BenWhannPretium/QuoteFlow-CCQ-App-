# ERF costing workbook (pre-makeover layout): structure (FB-14)

**Source:** Gemma Cebolla (Pricing), email "QuoteFlow: three templates still needed for costing and ROI", received 2026-11-11: a populated ERF costing workbook (3.9 MB) for a real quote. Gemma: the costing templates are being remade, and this is the existing template "prior to the makeover". Tracker A-031 (partly received), D-013, F-031.

**What this file is.** Structure only. **No customer, product, ERF number, plant, person, rate or figure from the workbook is recorded here or anywhere in the repo** (CLAUDE.md rules 5 and 8). It is a real quote and is kept outside the repo; it was read once, read-only, from a scratch script (ExcelJS streaming reader), never opened in Excel or saved. This layout is being retired, so nothing here is "the standard costing template": the new one has not arrived.

## Sheets (37)

| Sheet(s) | Visible | What it is (structure) |
|---|---|---|
| One costing sheet per variant (30 of them, named by size and resin mix, half of them a "+10%" copy) | yes | "COST ANALYSIS": description, plant, process, material, mold and capital information, cost build-up per unit, per thousand and per machine hour. Each also carries a plant rate table (fixed and variable overhead, labor rates, yields, box and pallet costs by plant) |
| One preform costing sheet | yes | Same layout for the preform |
| A legacy costing sheet from an earlier ERF | **hidden** | Same layout |
| `Summary` | yes | One column per variant (B to P): the cost and margin summary, plus a capital block (U–X). The candidate one-page source |
| `ERF` | yes | The ERF request form: commercial, plant and market, customer information. Also embeds lookup lists of staff names, emails and phone numbers |
| `ECE SUMMARY` | yes | Engineering cost estimate: project information, cost items per size, cycle, cavitation, OEE, labor, packaging |
| `PTF FORM` | yes | The offer letter, with a plant contact lookup |
| Two empty sheets | yes | No content |

**Defined names:** several, pointing at **other workbooks** (external links `[1]`, `[2]`), plus broken ones (`#REF!`) and a print area. None on the summary cells. **Size:** each costing sheet spans 16,384 columns and thousands of merged ranges, which makes a full (non-streaming) read slow and memory-heavy; the streaming reader skips those sheets.

## `Summary` sheet: candidate cells (first variant = column B; one column per variant)

| Row label (column A) | Cell (first variant) | Formula? | Number format |
|---|---|---|---|
| Grams (A3) | B3 | formula | number |
| Item (A4) | B4 | formula (text) | — |
| Customer (A5) | B5 | typed text | — |
| Resin Cost/lb, Mat, FOH, VOH, Labor, preform markup (A7–A12) | B7–B12 | formula | currency |
| **Total** (A13) — unit cost | **B13** | formula | `$#,##0.00` |
| **Revenue** (A15) | **B15** | formula | `$#,##0` |
| **Target Price** (A16) — price | **B16** | typed input | `$#,##0.00` |
| GM % (A17) | B17 | formula | `0.0%` |
| **CM%** (A18) — contribution margin % | **B18** | formula | `0.0%` |
| MM% (A19) | B19 | formula | `0.0%` |
| **Volume** (A22) — annual volume | **B22** | typed input | `#,##0` |
| GM$ Vol, GM$/M (A24–A25) | B24–B25 | formula | currency |
| **CM$ Vol** (A27) — contribution margin $ | **B27** | formula | `$#,##0` |
| CM$/M (A28) | B28 | formula | currency |
| GM / CM / MM per machine hour (A31–A33) | B31–B33 | formula | currency |

Capital block (columns U–X, one column per size, the first size in V):

| Label (column U) | Cell (first size) | Formula? |
|---|---|---|
| Annual Volume (U11) | V11 | typed input |
| Blow Molders, Molds, Freight, … Misc. Equipment (U14–U21) | V14–V21 | typed input |
| **Project Total** (U22) — capital / tooling | **V22** | formula |
| Customer Funded (U23) | V23 | formula |
| **Net Cost to Pretium** (U24) | **V24** | formula |

## The QuoteFlow map (seeded **inactive**, provisional, every field proposed)

`app_setting.model_summary_templates`, template `erf_costing_pre_makeover`, kind `cost_model`, **`active: false`**. Recognised by `Summary` with A13 "Total", A15 "Revenue", A18 "CM%" and `ECE SUMMARY`!C2 "ECE SUMMARY". Eight fields from the first variant's column: total cost (B13), target price (B16), revenue (B15), CM % (B18), CM $ on volume (B27), annual volume (B22), capital project total (V22), net capital cost (V24). While it is inactive a costing upload shows "No summary is set up for this kind of file yet" (quiet). The map reads one variant only; a multi-variant quote would need one field per variant, or the new template's own summary.

Checked 2026-11-12 through the FB-14 reader on Linux (scratch, read-only, the map forced active for the check only): recognised, `complete`, 8 fields, about 0.2 s and 16 MB.

## To confirm with Gemma

- Is this the layout Pricing keeps using until the makeover, and when does the new template land?
- On the new template: which cells hold unit cost, price and contribution margin ($ and %), and is there one column per variant?
