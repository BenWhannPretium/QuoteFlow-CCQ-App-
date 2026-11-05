# Utilization formula (Faron Ipox, email of 2026-11-04)

**Source:** Faron Ipox (Production Scheduler), reply to "CCQ | QuoteFlow Engineering / Supply Chain Follow-ups" (Bailey Schmitt, 2026-11-04). Tracker A-002 (done), A-023 (confirm), D-021 (basis, open), Q-035, V-074.

## As emailed (verbatim)

> During the meeting, the suggestion was to add what type of Utilization you want to use in the CCQ process.
>
> - I would suggest using the AVG % Utilized using current trending OEE and scheduled run days.
>
> This calculation is achieved by using the following:
> Calculation basis: Averages of actual production over the last 12 months, using scheduled days, average cavitation, average cycle time, and average trending OEE.
>
> 1. AVG Trending OEE by machine is based on ([AVG OEE 4 months - AVG OEE 13 months]/2)+AVG OEE 13 months
> 2. Trending capacity per month = (86400/AVG Cycle)\*AVG CAV\*Trending OEE\*scheduled run days per month\*Trending OEE
> 3. Then you take the Trailing 12 months (TTM) AVG Bottles produced per month and divide that by the Trending capacity per month

## Open point to confirm with Faron (A-023)

Step 2 multiplies by **Trending OEE twice**. That is almost certainly a typo. Applying OEE twice understates capacity, so utilization looks higher. FB-03 builds with OEE applied **once**:

```
trendingOEE            = ((avgOEE_4mo - avgOEE_13mo) / 2) + avgOEE_13mo
capacityPerMonth       = (86_400 / avgCycleS) × avgCavities × trendingOEE × scheduledRunDaysPerMonth
utilizationBeforePct   = TTM avg units per month / capacityPerMonth × 100
addedUtilizationPct    = (allocated annual volume / 12) / capacityPerMonth × 100
utilizationAfterPct    = utilizationBeforePct + addedUtilizationPct
```

- **In QuoteFlow (FB-03):**
  - The engineer enters **utilization before %** (Supply Chain's figure from the steps above) and the row's **effectiveness %** (the trending OEE).
  - QuoteFlow calculates the added load and **utilization after**.
  - Run days come from the provisional `capacity_basis` setting until D-021 is decided.
- **Monthly and annual are equivalent:** the annual form in the FB-03 prompt (× run days per year, annual volume) gives the same result as the monthly form above when run days per year = 12 × run days per month.
- **Still to confirm:** whether the trending OEE stays an engineer input or is derived from the 4-month and 13-month averages. If derived, those two averages become per-row inputs.
