# Plants and machine types (Jim Zweifel, 2026-11-10)

**Source:** Jim Zweifel (upfront Engineering), spreadsheet *QuoteFlow Plants and Process.xlsx*, dated 11.10.26 (2026-11-10).
**Approved by:** Ben Whann confirmed the list is correct (2026-11-10). Jim Zweifel is the named owner (tracker F-057, FB-09).
**Status:** approved. Loaded exactly as sent: nothing was questioned, "fixed" or dropped (this includes "12B" at St. Charles and the spelling "Etten.Leur"). The spreadsheet itself is not committed.
**Used by:** FB-13 (`docs/build-guide/prompts/feedback/FB-13-plants-machine-types.md`). The list is not customer data.

## The list, exactly as sent (22 locations)

| Location | Process / machine types (as sent) |
|---|---|
| Aurora | EBM |
| Bethlehem | EBM, IBM, ISBM |
| Boxmore | EBM, IBM, INJ - CAP, PAD PRINTING |
| Carrollton | EBM, ISBM, RHB |
| Cleveland, OH | EBM, INJ - PREFORM, RHB |
| Cleveland, TN | IBM, INJ - OTHER |
| Lerma, Ediplast | EBM, INJ - PREFORM, ISBM, RHB, DECO |
| Lerma, Ediprint | DIE CUTTING, LAMINATION, PRINTING, STAMPING |
| Etten.Leur | ISBM, RHB |
| Greensboro | EBM |
| Hazleton | ISBM, RHB |
| Hillsborough | IBM, ISBM, INJ - CAP, INJ - OTHER |
| Leipsic | EBM |
| Manchester | EBM, ISBM |
| Peru | ISBM |
| Salt Lake City | EBM, IBM, ISBM, RHB |
| St. Charles | 12B, INJ - CAP, ISBM, RHB, DECO |
| St. Laurent | EBM, IBM |
| St. Louis | IBM, INJ - CAP, ISBM |
| Toronto | EBM, IBM, INJ - OTHER |
| Troy | EBM, RHB |
| Vancouver | EBM, IBM, ISBM |

The older tracker figure "about 29 plants" is not a check: this list has 22 locations, and nothing in the build compares the count with 29.

## How it is stored

| Value list | Codes | Notes |
|---|---|---|
| `plant` | Stable upper-snake of the name: `AURORA`, `CLEVELAND_OH`, `LERMA_EDIPLAST`, `ETTEN_LEUR`, `ST_CHARLES`, … | Label = the name as sent. `meta.machineTypes` = that location's machine-type codes (data, not code). |
| `machine_type` | `EBM`, `IBM`, `ISBM`, `RHB`, `INJ-CAP`, `INJ-PREFORM`, `INJ-OTHER`, `DECO`, `PAD PRINTING`, `12B`, `DIE CUTTING`, `LAMINATION`, `PRINTING`, `STAMPING` | Jim's codes. The three injection types keep his label with spaces ("INJ - CAP"), as in the table above. |

Both lists are approved (`provisional = false`, `approved_at` 2026-11-10, `meta.approvedByName` = "Jim Zweifel"; `approved_by` stays null because Jim is not an app user, as for FB-09 and FB-12).

## What is retired

- Plants `PLANT_01` to `PLANT_03` (placeholders).
- Machine types `EBM_SHUTTLE`, `EBM_WHEEL` (already inactive since FB-03), `IBM_PRESS`, `ISBM_1STEP`, `ISBM_2STEP`, `INJECTION_PRESS`, `OTHER` (placeholders).

They become inactive, never deleted: a quote that already carries one keeps the code and shows its label with "(no longer offered)". No real quote is remapped; `pnpm --filter @ccq/db fb09:report` lists them with a suggested new value.
