# Markets, sub-markets and strategic-fit points (Melanie Rasche, 2026-11-09)

**Sources** (both 2026-11-09, Melanie Rasche, Director of Market Development, Food & Beverage):
1. Reply to "QuoteFlow: need your resin, market and product family lists by Tuesday" (Danielle Leu passed the market list to her). An image of the **markets (bold) with their sub-markets** underneath. It also marks each sub-market as **Unchanged** or **New**.
2. Reply to "QuoteFlow: your feedback on how quotes are scored, by Thursday". It includes the **GE Matrix Where to Play 9-box** (slide 21, "Strategic Where To Play Matrix") and her recommendation:

> "I recommend scoring strategic fit by **sub-market**. To keep our market-segmentation terminology consistent, we should use 'sub-market' rather than 'segment.' I support adding a sub-market field to QuoteFlow."
>
> "All sub-markets in the corresponding-colored boxes receiving the same score: **Strategic Growth (green): 80 · Selectively Participate (yellow and gray): 50 · Rationalization (red and pink): 20**." (Jessica Ransburg and Seamus Keith were invited to disagree.)

The slide carries budget figures, so it is **not** copied here (rule 8). Only the cell placement is.

This replaces `9-box.md` for placement. `9-box.md` was a text extraction that lost which segment sat in which cell; the image shows it.

## 9-box placement (read from the slide image) and points

| Cell | Colour | Points | Sub-markets in the cell (as written on the slide) |
|---|---|---|---|
| Primary Growth Engines | green | **80** | NW: Nutritional Powders |
| Upside Accelerators | green | **80** | F: Snacks, Spices/Seasonings · PC: Hair, Bath & Shower, Skin |
| Value Anchors | green | **80** | NW: VMS · ACC: Comm. Chemical |
| Future Capability Bets | gray | **50** | NW: RTD Meal Replacement |
| Low-Risk Yielders | yellow | **50** | NW: Liquid Supplements · F: Condiments, Oils, Ferments · B: Non-Alc Beverages |
| Specialist Niches | yellow | **50** | HC: Cleaning, Lawn/Garden · ACC: Auto Care · OTC: Consumer Health |
| Fix-or-Exit Watchlist | pink | **20** | F: Nut Butter & Spreads · PC: Sun Care · HC: Pest Control, Pet Care |
| Harvest Cash | pink | **20** | C: Specimen Cont, Swabs · B: Alc Bevs · F: Honey & Sweeteners · ACC: Life Sciences, Ag Chem |
| Strategic Divestitures | red | **20** | Non-Core Regions |

The colour bands do not follow the slide's three-row layout: Value Anchors (middle row) is green, and Future Capability Bets (top row) is gray. Melanie's rule is by **colour**, so this table is too.

## Markets and sub-markets, with points

Codes are proposed for FB-12. Markets that keep their meaning keep their code (`FOOD`, `BEVERAGE`, `PERSONAL_CARE`).

| Market (code) | Sub-market | Proposed code | Image tag | 9-box name | Points |
|---|---|---|---|---|---|
| Food (`FOOD`) | Condiments, Sauces & Dressings | `FOOD_CONDIMENTS` | New | F: Condiments | 50 |
| | Fermented Foods | `FOOD_FERMENTED` | New | F: Ferments | 50 |
| | Honey & Sweeteners | `FOOD_HONEY_SWEETENERS` | New | F: Honey & Sweeteners | 20 |
| | Snacks & Confections | `FOOD_SNACKS` | Unchanged | F: Snacks | 80 |
| | Nut Butters & Spreads | `FOOD_NUT_BUTTERS` | New | F: Nut Butter & Spreads | 20 |
| | Oils | `FOOD_OILS` | New | F: Oils | 50 |
| | Spices, Seasonings & Extracts | `FOOD_SPICES` | New | F: Spices/Seasonings | 80 |
| Beverage (`BEVERAGE`) | Non-Alcoholic | `BEV_NON_ALCOHOLIC` | New | B: Non-Alc Beverages | 50 |
| | Spirits & Mixers | `BEV_SPIRITS_MIXERS` | New | B: Alc Bevs | 20 |
| Nutrition & Wellness (`NUTRITION_WELLNESS`) | Liquid Supplements | `NW_LIQUID_SUPPLEMENTS` | New | NW: Liquid Supplements | 50 |
| | Nutritional Powders | `NW_NUTRITIONAL_POWDERS` | Unchanged | NW: Nutritional Powders | 80 |
| | Ready-to-Drink | `NW_READY_TO_DRINK` | New | NW: RTD Meal Replacement | 50 |
| | VMS | `NW_VMS` | Unchanged | NW: VMS | 80 |
| OTC Health (`OTC_HEALTH`) | Consumer Health | `OTC_CONSUMER_HEALTH` | New | OTC: Consumer Health | 50 |
| Clinical (`CLINICAL`) | Life Sciences | `CLIN_LIFE_SCIENCES` | Unchanged | ACC: Life Sciences | 20 |
| | Specimen Containers | `CLIN_SPECIMEN_CONTAINERS` | Unchanged | C: Specimen Cont | 20 |
| | Swabs | `CLIN_SWABS` | Unchanged | C: Swabs | 20 |
| | Histology | `CLIN_HISTOLOGY` | New | (not on the 9-box) | **unscored** |
| | Tubes & Vials | `CLIN_TUBES_VIALS` | New | (not on the 9-box) | **unscored** |
| Personal Care (`PERSONAL_CARE`) | Bath & Shower | `PC_BATH_SHOWER` | New | PC: Bath & Shower | 80 |
| | Hair Care | `PC_HAIR` | New | PC: Hair | 80 |
| | Skin Care | `PC_SKIN` | New | PC: Skin | 80 |
| Home Care (`HOME_CARE`) | Cleaning Supplies | `HC_CLEANING` | New | HC: Cleaning | 50 |
| | Pest Control | `HC_PEST_CONTROL` | New | HC: Pest Control | 20 |
| | Lawn & Garden | `HC_LAWN_GARDEN` | New | HC: Lawn/Garden | 50 |
| | Non-Core | `HC_NON_CORE` | New | see question 2 | **unscored** |
| | Pet Care | `HC_PET_CARE` | New | HC: Pet Care | 20 |
| Auto & Commercial Chemical (`AUTO_COMMERCIAL_CHEMICAL`) | Auto Care | `ACC_AUTO_CARE` | Unchanged | ACC: Auto Care | 50 |
| | Ag & Crop Management | `ACC_AG_CROP` | Unchanged | ACC: Ag Chem | 20 |
| | Commercial Chemical | `ACC_COMMERCIAL_CHEMICAL` | Unchanged | ACC: Comm. Chemical | 80 |

8 markets, 30 sub-markets. 27 are scored (8 at 80, 10 at 50, 9 at 20). 3 are unscored.

## Old market codes → new (for reports, not for remapping real quotes)

| Old code (label) | Becomes |
|---|---|
| `FOOD` (Food) | `FOOD`, kept |
| `BEVERAGE` (Beverage) | `BEVERAGE`, kept |
| `PERSONAL_CARE` (Personal Care) | `PERSONAL_CARE`, kept |
| `NUTRITION` (Nutrition/Supplements) | `NUTRITION_WELLNESS`; deactivate the old code |
| `HOUSEHOLD_CHEMICAL` (Household Chemical) | `HOME_CARE`; deactivate the old code |
| `PET` (Pet) | now the sub-market Home Care › Pet Care; deactivate the old code |
| `PHARMA_HEALTH` (Pharma/Health) | split between `OTC_HEALTH` and `CLINICAL`; deactivate, **no automatic mapping** |
| `INDUSTRIAL_CHEMICAL` (Industrial/Chemical) | `AUTO_COMMERCIAL_CHEMICAL`, mostly; deactivate, **no automatic mapping** |

## Open questions for Melanie (FB-12 builds with the provisional answer shown)

1. **Sun Care** is on the 9-box (Fix-or-Exit, 20) but not in the sub-market list. *Provisional: not added; Personal Care quotes for sun care pick the nearest sub-market or leave it blank.*
2. **Home Care › Non-Core**: is it the 9-box's "Non-Core Regions" (Strategic Divestitures, 20), or a catch-all for other home-care products? *Provisional: unscored (it gets the neutral default).*
3. **Histology** and **Tubes & Vials** (Clinical, New) are not on the 9-box. *Provisional: unscored.*
4. **Life Sciences** sits under ACC on the 9-box but under Clinical in the list. The points are 20 either way; the list's placement (Clinical) is used.
