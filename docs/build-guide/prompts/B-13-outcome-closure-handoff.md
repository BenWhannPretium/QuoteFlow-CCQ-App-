# B-13 · Customer decision, outcome closure, validity, minimal hand-off (CR-37/38/39/40/41)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `01-architecture.md` §4.1 and §5 (`handoff_record`) and `04-decisions-and-risks.md` (D-12, D-14, D-15). Today 71% of FY26 YTD requests have no recorded customer outcome and there are no loss reason codes. Making outcome + reason mandatory is what turns win rate into a measurable number (PRD goal) and closes the "going dark" gap.

## Customer Decision stage (owner KAM; SalesLeader may act)
- **Quote header:** proposal issued date, **validity countdown** (days left; amber at ≤ 7, red when expired), SF stage side by side with a mismatch flag (e.g. CCQ "Customer Decision" vs SF "Closed Won").
- **"My open proposals"** list for the KAM, sorted by validity end.

## G5 Outcome recorded (generic gate; decider KAM or SalesLeader)
| Outcome | Requires | Effect |
|---|---|---|
| **Awarded** | Acceptance evidence type (verbal award / PO / LOI / contract), date, optional document link | → AWARDED, then opens the **hand-off record** form |
| **Lost** | Reason code (price, lead time, capability, capacity, customer cancelled, competitor relationship, other+note), optional competitor/notes | → CLOSED_LOST |
| **No response / Expired** | Validity has passed (or a manual note) | → EXPIRED. Explicitly **not Lost**: "silence is not a loss" |
| **On hold** | Hold reason + review date | status on_hold; the clock stops for cycle time |
| **Re-quote** | Change reason code (scope / volume / resin / terms / other) + target stage | Back to the target stage, version bump; prior approvals kept and marked superseded, never edited (CR-38) |

**Closure rule (CR-39):** a quote can't reach a terminal state without `outcome`, `outcome_reason_code` (where the outcome requires one), `closure_owner_id` (defaults to the KAM; SalesLeader may set it) and `closed_at`. This is enforced in the domain and covered by tests.

**Internal no-go at any gate** (G1 Stop, G2 Stop, G3 Stop, G4 Decline) also closes with a reason and deciding role (CR-40). That's already true from earlier steps; add a test that sweeps every terminal path for the mandatory fields.

## Expiry job
A daily job (advisory lock) flags quotes whose `validity_until` has passed, writes an activity event and notifies the KAM ("Revalidate or record the outcome"). It does **not** auto-close: the interval and revalidation policy are D-12 (open).

## Minimal hand-off record (Stage 6, minimal in MVP)
Shown on AWARDED quotes; editable by KAM, SalesLeader and Admin:
- acceptance evidence
- **CER ID** (Apex; link only)
- **BPR ID** (price implementation; link only)
- receiving role (Commercial Activation / NPI post-award technical PM / other)
- receiving contact name
- accepted-by date
- notes

A "Hand-off complete" checkbox records who confirmed it. No integrations (CER/BPR integration is Scale, after the capital-system redesign). Amanda Cronkhite takes ownership of Commercial Activation on 10/26; confirm the fields with her at R3 (optional).

## Reason-code taxonomy
Load from `reason_code` config (seeded in B-03, provisional). If D-15 lands by Oct 28, update the seeds and mark them `provisional=false` with `approved_by`.

## API
- `GET /quotes/mine/proposals`
- `PUT /quotes/:qn/handoff`
- G5 goes through the generic gate route.
- Admin report `GET /admin/reports/outcomes` returns counts by outcome and reason, and the capture rate.

## Tests
- Every terminal path requires the closure fields.
- Expired ≠ lost in reports.
- Re-quote versioning keeps the old decisions.
- Validity countdown with a frozen clock.
- Hand-off only on AWARDED.
- Playwright: a KAM records Awarded + hand-off, and a Lost with a reason.

## Acceptance
- [ ] No quote can close without an outcome + reason + owner + date
- [ ] Validity date and expiry flag work; nothing auto-closes
- [ ] Hand-off record captures the CER/BPR IDs and receiving role
- [ ] Tick B-13 in `docs/build-guide/03-build-steps.md`, noting whether D-15 is approved or still provisional
