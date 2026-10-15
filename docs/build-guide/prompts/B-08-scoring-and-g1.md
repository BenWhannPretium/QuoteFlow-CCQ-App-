# B-08 · Weighted prioritization engine (F-05) + G1 qualification (CR-10/11)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `01-architecture.md` §4–5 and `04-decisions-and-risks.md` (D-06, D-19, X-89). Priority today is "whoever pushes hardest". The PRD asks for a transparent, weighted, explainable score. **In MVP the score is advisory.** It orders the queue and informs G1, but a human decides. Weights and attributes are not yet approved, so everything is config.

## Scoring engine (`packages/domain/src/scoring/`)

### 1. Model config (`scoring_model` table, versioned)
```ts
{ version: 1, attributes: [
  { key: 'revenue', label: 'Estimated annual revenue', weight: 0.20, input: 'quote.est_annual_revenue', bands: [[0,25000,10],[25000,100000,40],[100000,250000,70],[250000,null,100]] },
  { key: 'volume', label: 'Estimated annual volume', weight: 0.15, input: 'quote.est_annual_volume', bands: [...] },
  { key: 'strategic_fit', label: 'Strategic fit (where to play)', weight: 0.15, input: 'map', map: { by: 'market', values: { /* market code -> 0..100 */ }, default: 50 } },
  { key: 'capital_exposure', label: 'Capital exposure', weight: 0.15, input: 'eng_review.prelim_capital_usd', inverse: true, bands: [...], unknownScore: 50 },
  { key: 'customer_risk', label: 'Customer risk', weight: 0.10, input: 'map', map: { by: 'customer.status', values: { existing: 80, not_yet_established: 40 } } },
  { key: 'product_fit', label: 'Product fit', weight: 0.15, input: 'map', map: { by: 'product_family+resin', values: {}, default: 50 } },
  { key: 'timing', label: 'Timing (days to expected close)', weight: 0.10, input: 'days_to_close', bands: [[null,30,100],[30,90,70],[90,180,40],[180,null,20]] }
], tiers: [{ key:'CRITICAL', min:80 }, { key:'HIGH', min:60 }, { key:'STANDARD', min:40 }, { key:'LOW', min:0 }] }
```
These are the **PRD's 7 attributes** (F-05). The 10/14 prototype used a different set: opportunity size, risk profile, credit quality, stage momentum, close urgency, client relationship, product margin. Make the attribute registry generic enough that the prototype set could be configured as v2 with no code change. Add an `inputs` resolver registry so new attribute inputs are a small code addition.

### 2. Functions
- `score(model, facts, now)` returns `{ total (0–100, 1 decimal), tier, breakdown: [{ key, label, weight, raw, points, contribution, explanation }], unknowns: [keys] }`
- An unknown input uses `unknownScore` and is listed in `unknowns`, so the UI can say "Capital exposure unknown until Engineering Review".
- Weights must sum to 1 (validated in config). Results are deterministic, so snapshot-test them.

### 3. Recalculation
- Recalculate on intake submit, on any change to an input field, and after the G2 capital estimate.
- Store `priority_score`, `priority_tier` and `scoring_model_version` on the quote. Write an `activity_event` when the tier changes.
- **If the tier is overridden (B-09), keep the computed score but display the override tier.**

### 4. Qualification screens (warnings only; D-06 open)
- `min_opportunity_value_warning_usd` and `min_volume_warning_by_process` (empty by default) raise **warnings** shown at G1 ("Below the $X minimum; requires strategic exception note"). Darren's example: an $18k opportunity can't justify a new mold set.
- Never auto-reject.

## G1 Qualify & prioritize (UI + API)

- **Queue:** `/approvals?gate=G1`, labelled "To qualify", for SalesLeader. It lists submitted intakes sorted by score and shows warnings and the request class.
- **G1 decision dialog** (generic `GateDecisionDialog` driven by `availableActions` from the domain):
  - **Advance**: optional note. Sends the quote to the engineering queue.
  - **Hold**: requires a review date and reason.
  - **Rework**: requires a reason and returns the quote to the KAM's drafts, with a banner showing what to fix.
  - **Redirect** (stock / inquiry / other capital): requires a reason and closes as REDIRECTED.
  - **Stop**: requires a reason code + note and closes as DECLINED.
- The dialog shows the score breakdown, warnings and a completeness summary.
- **Config flag `g1_enabled`:** when false, submit goes straight to ENG_REVIEW and the G1 queue is hidden. This keeps the engineering queue working even if leadership decides MVP has no qualify gate.
- **API:** `POST /api/v1/quotes/:quoteNumber/gates/G1/decisions` `{ outcomeKey, note?, reasonCode?, holdUntil? }` → domain `evaluateTransition` → persist the effects atomically.
  - This **generic gate-decision route** is reused by G2–G5. Build it once in `apps/api/src/routes/v1/gates.ts` and `services/gateService.ts`.
  - Writes: `gate_decision` (with an evidence snapshot of the score breakdown and key intake fields), `stage_history`, `activity_event`, `audit_event`, and notifications (via the B-18 hook; stub for now).

## UI on quote detail
- `ScorePill` + `TierChip` everywhere a quote appears.
- "Why this priority?" popover with the breakdown table and model version.
- If `kam_can_see_peer_scores=false`, hide other KAMs' scores (server-side redaction).

## Tests
- Snapshot tests for scoring on 10 fixture quotes; weight-sum validation; unknown handling.
- G1 all outcomes via the generic route; permission matrix: only SalesLeader decides G1.
- `g1_enabled=false` path.
- Playwright: a SalesLeader qualifies one quote and redirects another.

## Acceptance
- [ ] Score and tier visible with an explanation; recalculates on input change
- [ ] G1 works end to end with all 5 outcomes, reasons and notes enforced by the domain
- [ ] Generic gate route + service exists and is documented for reuse
- [ ] Tick B-08 in `docs/build-guide/03-build-steps.md`, noting the attribute set and decider confirmed at M4
