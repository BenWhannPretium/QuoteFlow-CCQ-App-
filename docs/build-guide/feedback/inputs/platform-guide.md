# Pretium Machine Platforms (Danielle Leu, 2026-11-04)

**Source:** `Pretium Machine Platforms.pdf`, attached to Danielle Leu's reply to "CCQ | QuoteFlow Follow-up" (Bailey Schmitt, 2026-11-04). Marked **INTERNAL ONLY**. Danielle has already shared it with the sales leads for the KAMs. Tracker A-010 (done), D-004, F-066, V-047.

> "†New-mold planning minimums—not stock MOQ." "Indicative tooling estimates; project-dependent; confirm current quote after final drawing approval." "*RHB assumes existing preform."

**Confirmed by Danielle Leu on 2026-11-09** (reply to "QuoteFlow: please confirm our read of the Machine Platforms guide by Thursday"). Her edits replace the size, minimum and tooling columns we had matched by fit. ISBM and Injection swapped minimums, and the ISBM, Injection and EBM sizes and lead times changed. The resin, advantage and market columns are from the PDF and were not part of her edit.

| Platform | QuoteFlow `process_type` | Resins | Advantages | Ideal packs and markets | Size | Min. program† | Tooling from |
|---|---|---|---|---|---|---|---|
| ISBM | `ISBM` | PET / rPET | Clarity; oriented necks; wide necks > 40 mm; square / flat panels | Square packers / bottles: sauces, oils, spices; beauty, supplements | 0.25–250 oz; ideal 10 oz+ | **1M units** | ~20 weeks |
| RHB | `RHB` | PET / rPET | High output; existing preforms; lightweighting potential | Rounded PET bottles: beverage, oils, sprayers; personal care | 4–100 oz; ideal 8–80 oz | 1M units | ~6 weeks (assumes existing preform) |
| Injection | `IMM` | PP / HDPE / LDPE | Precise features; thick / double-wall jars | Jars, caps and lids: beauty, food, wellness | 0.25–40 oz; ideal 3–32 oz | **3M units** | ~18 weeks |
| IBM | `IBM` | HDPE / PP / LDPE | Precise necks; internal snap fits; no parison-flash trim | Small bottles / packers: pharma, health; personal care | Ideal 8 oz and below | 3M units | ~18 weeks |
| EBM | `EBM` | HDPE / LDPE / PCR | Handleware; shape flexibility; adjustable weight | Handled jugs / oblongs; wide-mouth canisters: household, industrial, nutrition, food | Ideal 8 oz+ | 1M units | ~12 weeks |

**What changed from our 2026-11-05 read:** ISBM 3M → **1M**, 0.25–40 oz → 0.25–250 oz, ~18 → ~20 weeks. Injection 1M → **3M**, "ideal 8 oz+" → 0.25–40 oz (ideal 3–32 oz), ~10 → ~18 weeks. EBM 2–250 oz (ideal 10 oz+) → ideal 8 oz+, ~20 → ~12 weeks. RHB and IBM unchanged.

**In QuoteFlow:** `intake_guardrails.minAnnualVolumeByProcess` = ISBM 1M, RHB 1M, IMM 3M, IBM 3M, EBM 1M (seed and migration 0035, which corrects environments still holding FB-10's values). The warning stays **off** and provisional until D-004 agrees to warn at these volumes; an Admin switches it on. The lowest minimum (1M) still applies while the platform is unknown at intake, so the unknown-platform warning is unchanged. Size ranges and lead times are not used by the app.

**A sense check for Bailey (not a blocker):** Danielle's ISBM size range (0.25–250 oz) is the one we had under EBM, and her Injection range (0.25–40 oz, ideal 3–32 oz) is the one we had under ISBM, so a row may have shifted in her reply. The minimums are what the app uses, and those are as she wrote them. Worth one line back to her: "ISBM 1M and Injection 3M: correct?"

<details><summary>Our original read (2026-11-05), kept for history</summary>

| Platform | QuoteFlow `process_type` | Resins | Advantages | Ideal packs and markets | Size | Min. program† | Tooling from |
|---|---|---|---|---|---|---|---|
| ISBM | `ISBM` | PET / rPET | Clarity; oriented necks; wide necks > 40 mm; square / flat panels | Square packers / bottles: sauces, oils, spices; beauty, supplements | 0.25–40 oz; ideal 3–32 oz | 3M units | ~18 weeks |
| RHB | `RHB` | PET / rPET | High output; existing preforms; lightweighting potential | Rounded PET bottles: beverage, oils, sprayers; personal care | 4–100 oz; ideal 8–80 oz | 1M units | ~6 weeks* |
| Injection | `IMM` | PP / HDPE / LDPE | Precise features; thick / double-wall jars | Jars, caps and lids: beauty, food, wellness | Ideal 8 oz+ | 1M units | ~10 weeks |
| IBM | `IBM` | HDPE / PP / LDPE | Precise necks; internal snap fits; no parison-flash trim | Small bottles / packers: pharma, health; personal care | Ideal 8 oz and below | 3M units | ~18 weeks |
| EBM | `EBM` | HDPE / LDPE / PCR | Handleware; shape flexibility; adjustable weight | Handled jugs / oblongs; wide-mouth canisters: household, industrial, nutrition, food | 2–250 oz; ideal 10 oz+ | 1M units | ~20 weeks |

</details>
