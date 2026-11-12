# Capacity Exhibit: structure (FB-14)

**Source:** Stacy Slocum (Finance), received 2026-11-11 with the payback calculator: *Capacity Exhibit.xlsx*, an equipment capacity calculator ("because I like it. And it's useful."). Not asked for. No tracker ID yet.

**What this file is.** Structure and formulas only. **No equipment, plant or figure from the workbook is recorded here.** Read once, read-only, from a scratch script.

## Layout

One sheet, `Capacity`. One row per piece of equipment (rows 5–24). Defined names: none.

| Column | Header | Input or formula |
|---|---|---|
| A | Equipment | input |
| B | Cavities | input |
| C | Cycle Time (sec) | input |
| D | Expected OEE | input (a fraction) |
| E | Schedule (`24/7` or `24/5`) | input |
| F | Avg Weight (g) | input |
| G | Avg Weight (lbs) | `F / 453.592` |
| H | Theoretical (24/7/365 @ 100%): Daily (parts) | `24 × 60 × 60 / C × B` |
| I | Theoretical: Annual (parts) | `H × B25` |
| J | Expected (24/7/365 @ OEE): Daily (parts) | `H × D` |
| K | Expected: Annual (parts) | `J × B25` |
| L | Practical (schedule @ OEE): Daily (parts) | `J` |
| M | Practical: Annual (parts) | `J × B25 × (last digit of E) / 7` |

Cell A25 reads "Annual Days Assumption" with the input in **B25**; the received file has **360** there. The footnote (A26) says: daily is one full 24-hour run day; practical annual is expected daily times run days a year, **24/7 = 365 days, 24/5 = 5 days a week (about 261 days)**. The formula cells had no cached values (the file was not calculated after the inputs were cleared).

## The inconsistency (question for Stacy)

The theoretical and expected annual figures are labelled "24/7/365" but multiply by B25 (360). The practical annual figure is 360 × 5 / 7 ≈ 257 days for 24/5, while the footnote says about 261. QuoteFlow does not resolve this silently: it asks Stacy which is meant.

## In QuoteFlow (FB-14 capacity helper)

`capacityAtAGlance` in `packages/domain/src/engineering/capacity.ts`, shown read-only under each capacity-evidence row in Engineering Review as "Capacity at a glance (calculated from the row above)":

- theoretical = 86,400 / cycle time × cavitation a day, × **365** a year (24/7/365, as labelled);
- expected = theoretical × the row's effectiveness % (the OEE stand-in), × 365 a year;
- practical = expected a day × the row's **scheduled run days** (blank = `capacity_basis.scheduledRunDaysPerYear`, provisional, D-021), not the exhibit's 360. This is exactly the capacity FB-03's utilization divides by.

OEE is applied **once**, as FB-03 reads Faron Ipox's formula ([`capacity-formula.md`](capacity-formula.md), A-023). Pounds are shown when intake has the part's gram weight. No new input, no change to utilization or G2.
