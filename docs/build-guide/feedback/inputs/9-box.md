# Where to Play 9-box (strategic fit by market)

**Sources:**
- Melanie Rasche posted "WTP 9-box" as an image in the Sales & Marketing walkthrough meeting chat (2026-11-03, tracker A-009). The image is not readable through the connector. **Ask Melanie for the file**, or export the image here as `9-box.png`.
- The matrix below is from `Where We Play and How We Win (2026-11-03).pptx` (SharePoint, Molder site › Claude outputs), slide "Strategic Where to Play Matrix". It is likely the same grid Melanie shared. Budget figures are left out on purpose.

**Axes:** market attractiveness × organizational ability to compete. **Bands:** Strategic Growth (invest), Selectively Participate, Rationalization.

| Band | Cell | Intent |
|---|---|---|
| Strategic Growth | Primary Growth Engines | Proactively invest to expand capacity and realize growth |
| Strategic Growth | Upside Accelerators | Fix operational gaps to capture attractive markets |
| Strategic Growth | Future Capability Bets | Create the "right to win" in high-value spaces |
| Selectively Participate | Value Anchors | Use scale and footprint to combat commoditization in large markets |
| Selectively Participate | Low-Risk Yielders | Balance price and complexity |
| Selectively Participate | Fix-or-Exit Watchlist | Retain only if high-margin and low-risk |
| Rationalization | Specialist Niches | Maintain efficiency in narrow niches; prioritize cash |
| Rationalization | Harvest Cash | Zero reinvestment; extract cash through end-of-life |
| Rationalization | Strategic Divestitures | Wind down or rationalize |

**Segments listed on the slide** (NW = Nutrition & Wellness, F = Food, PC = Personal Care, HC = Household, B = Beverage, ACC = Ag/Commercial Chemical, C = Clinical, OTC = consumer health):

| Group as extracted | Segments |
|---|---|
| Strategic Growth (1) | NW: RTD meal replacement · F: Snacks, Spices/Seasonings · PC: Hair, Bath & Shower, Skin |
| Strategic Growth (2) | NW: Nutritional powders · F: Nut butter & spreads · PC: Sun care · HC: Pest control, Pet care |
| Strategic Growth (3) | NW: Liquid supplements · F: Condiments, Oils, Ferments · B: Non-alcoholic beverages |
| Selectively Participate | NW: VMS · ACC: Commercial chemical |
| Rationalization | Non-core regions · C: Specimen containers, Swabs · B: Alcoholic beverages · F: Honey & sweeteners · ACC: Life sciences, Ag chem · HC: Cleaning, Lawn/Garden · ACC: Auto care · OTC: Consumer health |

**What this means for the build (F-073, D-004):**
1. **The cell placement is uncertain.** The text extraction loses which segment sits in which cell. Confirm it with Melanie Rasche.
2. **The grid is by segment, but QuoteFlow's `market` list is coarse** (Food, Beverage, Nutrition/Supplements, Personal Care, Household Chemical, Pharma/Health, Industrial/Chemical, Pet). In the grid, Food appears in Strategic Growth (Snacks) and in Rationalization (Honey), so one market can't carry one score. D-004 has to choose one of:
   - (a) add a `market_segment` value list at intake (F-020) and score by segment, or
   - (b) score by market using the band most of its revenue sits in.
3. **No points are defined yet.** D-004 must set the points per cell or band, e.g. Strategic Growth 90 / 75 / 60, Selectively Participate 50, Rationalization 20. Until then FB-04 shows market and points but **seeds no values**, and FB-10 loads them once decided.
