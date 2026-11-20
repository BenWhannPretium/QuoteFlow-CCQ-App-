# Tracker updates of 2026-11-19 (proposed; not yet applied to the workbook)

These rows come from the close-outs of FB-28 to FB-33 (all merged to `main`). `QuoteFlow Feedback Tracker.xlsx` is **not** edited here and is not committed (`*.xlsx` is git-ignored). Each row is tab-separated, in the Build Backlog column order of `tracker-updates-2026-11-12.md`; the `F-___` IDs are for Ben to assign when the rows are added. The change-log rows are in `feedback-change-log.md` and `QuoteFlow Change Log.csv`.

Sources read: section 5 of the six close-out files (now deleted).

## FB-28: Release guard (PR [#120](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/120), built 2026-11-19)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Release and deploy	Release guard: migration upgrade check on every PR, wait-for-deploy script	Build change	CI job "Migration upgrade check" applies main's migrations then the PR's to a fresh database, checks each new migration's idx, tag and when (above the largest ever merged), and starts the API; scripts/wait-for-deploy.sh reports whether a merge reached the test site healthy (exit codes 0/10/11/12/13/2); 09-release-guards.md has the guard limits, the when rule and a rollback playbook	Ben Whann	In Progress	FB-28, PR https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/120 (draft); needs the check made required on main
```

## FB-29: Salesforce write-back (PR [#123](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/123), built 2026-11-20)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Integration	Salesforce write-back of stage and outcome (governed, switched off)	Build change	Outbox queued with the G5 decision and the linked re-quote; worker with retries and Admin alerts; separate write identity; sandbox-only outside prod; allow-list StageName; Admin card with dry run, Retry, Skip, Preview; reminder follows the switch. Off until IT and the Salesforce owner approve.	Darren Miller, Sarah Brennan	In Progress	FB-29 https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/123
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Integration	QuoteFlow stays complete without Salesforce (one source of truth for stage and outcome)	Build change	No decision waits for or fails on Salesforce; closing writes skipped while another quote or re-quote needs the opportunity; no backwards stage moves; no "closed lost" flag on quotes QuoteFlow closed.	Sarah Brennan, Oleg Yarovinski, Bailey Schmitt	In Progress	FB-29 https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/123
```

## FB-30: Engineering and Capacity apart (PR [#121](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/121), built 2026-11-20)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Engineering	Engineering and Capacity apart: two tabs, two recommendations	Build change	A Capacity tab beside Engineering; an Engineering recommendation and a Capacity recommendation at the top of each; each person opens on their own tab; the scheduler's notices and Capacity requests open Capacity; two blocks on Overview, Quoting and Final Review. One G2 decision; nothing new stored.	Sarah Brennan	In Progress	FB-30, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/121
```

## FB-31: Commercial terms governance (PR [#122](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/122), built 2026-11-19)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Commercial terms	Payment-terms approval routes by threshold	Build change	Non-standard payment terms route by config (terms_exception_routes): Net 45 to the pricing lead; Net 60, 90, 120 and Other to Leadership (CFO stand-in) with a supporting document. Tier recorded on the request; requester barred on the senior tier. Seed is a provisional guess.	Sarah Brennan, Oleg Yarovinski	In Progress	FB-31, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/122
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Commercial terms	Four tooling funding choices; amortization needs finance review	Build change	Customer funded (lump sum), Customer funded (amortized), Pretium funded, To be determined; $0 CER and Shared retired for new choices; amortized adds a Leadership finance-review sign-off at Final Review (provisional).	Sarah Brennan, Darren Miller, Oleg Yarovinski	In Progress	FB-31, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/122
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake	Inventory and safety stock requirements wording	Build change	The stock question and its labels use the contract's words: inventory and safety stock requirements. Fields unchanged.	Sarah Brennan	In Progress	FB-31, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/122
```

## FB-32: Less double entry (PR [#125](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/125), built 2026-11-20)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake / Salesforce	Item 1's name from Salesforce, and a prefill map	Enhancement	Item 1's name is filled from the opportunity's first Salesforce product (its name, else its size) and tagged "from Salesforce"; a typed name is never replaced. A map in code says which Salesforce field feeds which question.	Sarah Brennan	In Progress	FB-32, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/125
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake / Salesforce	"Salesforce says X, Use this" hint for Color (off)	Enhancement	A hint under Color for an exact list match, never automatic, switched off (intake_sf_suggestions_enabled) until Zachary Cairns confirms what the Salesforce Color field means.	Sarah Brennan; Zachary Cairns	In Progress	FB-32, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/125
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake / Salesforce	Candidates list for Zachary Cairns	Documentation	Every intake question with its Salesforce source or candidate field, and three standing questions (market and sub-market, container and neck on the product record; finished-good type and Product Type; where the KAM-to-sales-leader line is kept).	Sarah Brennan	In Progress	FB-32, salesforce-prefill-candidates.md, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/125
```

## FB-33: Words on screen (PR [#124](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/124), built 2026-11-20)

Build Backlog:

```
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake	Spell out Commercial Capital Quote	Change	Request-class list and help, the active-quote message and the opportunity search say Commercial Capital Quote (CCQ); quote numbers, group names and the Submit button keep CCQ	Sarah Brennan, Oleg Yarovinski, Darren Miller	In Progress	FB-33, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/124
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake	Stock and Stock-Plus are in Salesforce	Change	The message under a Stock request, the request-class help and the G1 "not CCQ work" help say Salesforce; price inquiries and pack-out evaluations unchanged	Darren Miller	In Progress	FB-33, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/124
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake	Credit check is not a QuoteFlow step	Report	No text implies a credit check; proposal for the new-customer help is in the PR, not shipped	Darren Miller	In Progress	FB-33, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/124
F-___	CCQ MVP Demo and Open Decisions (Nov 19)	Intake	Variants example without a site choice	Change	The example under Quote variants requested is about PCR levels only; the site-alternatives design is not started (needs Jim Zweifel)	Sarah Brennan, Bailey Schmitt	In Progress	FB-33, https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/124
```
