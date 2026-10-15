# B-11 · Quoting stage: Pricing record, capital readiness, G3 (CR-25/26, DEC-19/20/23)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` (rules 2 and 5), `01-architecture.md` §3.3 and §5 (`pricing_record`). Pricing is a **required gate**: "All pricing requests and decisions [are] reviewed and approved through the Pricing team" (DEC-20, 9/21). Today the approved price lives in free text, e.g. "approved at 174.98 per thousand, FOB… based on March CDI". The MVP records the **approval as a decision**, not the pricing math: how Pricing derives prices is out of scope (DEC-23), and editing figures or pricing in CCQ is out of scope (PRD §9).

## Pricing queue (`/queue/pricing`; role Pricing; Leadership read)
- All quotes in `QUOTING`, sorted by tier → score → time in stage.
- Columns: tier, quote number, account, product summary, volume, G2 outcome (flag "Capital required" / "Proceed with risk"), capital readiness, time in stage, KAM, assigned engineer.
- Filters and search as in other queues.

## Quoting tab on quote detail (editable by Pricing while in QUOTING)
1. **Read-only engineering summary:** solution, capacity evidence, preliminary capital (Pricing can see commercial fields).
2. **Pricing context:** a slot for the B-15 pricing-app panel. Until then, manual **pricing-app references**: ERF number(s) and BPR number(s), validated by format only. Make the format regexes config; ask Cory McGahan for real formats at M5.
3. **Price approval record:**
   - approved by (defaults to the current Pricing user; selectable among Pricing users)
   - approved at
   - pricing basis note (e.g. resin index month, FOB terms)
   - approved negotiation range note (free text; guardrails are D-10, open)
   - checkbox "Costing completed (Cost-to-Serve)", recording the costing-before-pricing checkpoint (CR-25) as attestation only, because costing stays in Excel
4. **Capital readiness:** `not_required | pending | pre_approved | not_approved`, plus CER reference (optional ID) and notes. If G2 was "Capital required", it can't be `not_required`.
5. Everything on this tab is **commercial**. Redact it for KAM and Engineer (they see "Price approved ✓ on <date> by <name>" but no figures or notes). Add tests for this.

## G3 Submit to Final Review (generic gate; decider Pricing)
- **Submit**: requires a price approval record (approved_by, approved_at), at least one pricing reference or an explicit "no pricing-app record yet" note, and capital readiness ≠ pending **unless** a "pending capital" justification is given (D-11 is open, so this is a warning, not a block). Goes to FINAL_REVIEW and notifies the Approver group.
- **Hold**: reason + review date.
- **Rework → ENG_REVIEW**: reason. Bumps the version.
- **Stop**: reason + note. Closes as DECLINED.
- **Segregation:** Pricing users cannot hold `gate.G4.decide` on the same quote; this is enforced by the domain segregation rules.

## API
- `GET /queue/pricing`
- `PUT /quotes/:qn/pricing-record`
- `PUT /quotes/:qn/capital-readiness`
- G3 goes through the generic gate route.

Add the permission-matrix entries and the redaction tests for every new read route.

## Tests
- Redaction: a KAM GET on the quote shows no pricing notes or ranges or capital figures, but does see the approval status.
- G3 required fields; "Capital required" path; Rework bumps the version and keeps the prior pricing record as history (versioned rows, not overwritten).
- Playwright: Pricing records an approval and submits to Final Review.

## Acceptance
- [ ] Pricing queue + record + G3 work; price approval is no longer free text
- [ ] No editable price figure anywhere in CCQ
- [ ] Ready for **R3 (Thu Nov 5)** with Gemma Cebolla
- [ ] Tick B-11 in `docs/build-guide/03-build-steps.md`
