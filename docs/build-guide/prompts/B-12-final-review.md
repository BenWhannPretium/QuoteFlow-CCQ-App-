# B-12 · Final Review: G4 internal approval of the customer proposition (F-16 as a P0 decision record, CR-29)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `01-architecture.md` §4.1 and `04-decisions-and-risks.md` (D-10, X-88). Final Review is the **internal** decision: "Is this the offer Pretium is prepared to commit to, on these terms?"

PRD F-16 said approve/decline "promotes to Awarded or Closed Lost". That conflates internal approval with the customer's decision, and the Operating Model fixes it (X-88). In CCQ:
- **Approve** moves the quote to Customer Decision.
- **Decline** closes it as DECLINED (an internal no-go).
- Only the **customer** outcome (B-13) sets Awarded or Lost.

## Approvals queue (`/approvals`; Approver; Leadership read)
- Tabs:
  - "Final Review" (G4)
  - "To qualify" (G1, from B-08; shown only to SalesLeader)
  - "Overrides" (from B-09)
- Final Review rows show: tier, quote number, account, product, volume, price approval status, capital readiness, G2 outcome (risk flags), time waiting, KAM and Pricing approver.
- Mobile-first: the approver must be able to decide from a phone (F-14). Use a card layout with a sticky decision bar.

## Review screen
A one-page summary (the PRD's "one-page snapshot") assembled from:
- intake summary
- score breakdown
- engineering solution + capacity evidence
- pricing approval + basis + range note
- capital readiness
- attachments list
- open warnings
- full timeline link

## G4 Release proposition (generic gate; decider Approver)
- **Approve**: optional note.
  - Next stage: CUSTOMER_DECISION.
  - Set `proposal_issued_at` (default now; editable to the actual send date).
  - Set `validity_until = issued + validity_days_default` (config, provisional 30 days; D-12).
  - Notify the KAM: "Approved; issue the proposal."
- **Decline**: **note required** (the 10/14 demo rule) + reason code (decline context). Closes as DECLINED, records the deciding role, and notifies the KAM + Pricing.
- **Return**: note required; choose the target stage (QUOTING or ENG_REVIEW). Bumps the version.
- **Segregation:** the approver ≠ the quote's KAM, and ≠ the Pricing approver on this quote. These are domain rules, tested.
- **Who is an Approver:** whoever IT puts in `SG-CCQ-Approver`. The decision (D-10) is pending: Sarah Brennan, Darren Miller, Paul Slomkowski, a sales leader within delegation, or a delegate. **No names in code.**
- **Tiers:** a placeholder setting `g4_tier_rules=null`. When set later (e.g. by capital or revenue), the domain can require a specific approver group. Implement the hook and the tests with a sample rule, but leave it **disabled**.

## API
`GET /approvals?gate=G4`, `GET /quotes/:qn/review-summary`; decisions go through the generic gate route.

## Tests
- Approve sets the validity date from config; decline requires a note + reason; return bumps the version.
- Segregation tests; tier hook test (enabled in the test only).
- Playwright: an approver on a 390px viewport approves one quote and declines another.

## Acceptance
- [ ] Approve and decline never set Awarded/Lost; customer outcome stays separate
- [ ] Mobile approval works
- [ ] Tick B-12 in `docs/build-guide/03-build-steps.md`, recording who was confirmed as Approver (D-10)
