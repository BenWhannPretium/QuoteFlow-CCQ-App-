# B-10 · Engineering queue and Engineering Review (F-04, F-07, CR-14/15/18/19, DEC-26)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `01-architecture.md` §3–5 and the generic gate service from B-08. Engineering is the binding constraint on time-to-quote. In FY26, 87 requests sat at "Engineer Assigned", and turnaround runs from 3 days to 3+ weeks. The MVP decision (DEC-26, Darren 10/14) is: "**manual prioritized queue to the upfront engineering lead, who is alerted and assigns in-app; rules-based routing is P1**." Darren's reasoning: "We're intentionally doing it manually so that we can learn… I wouldn't automate what he has."

## Part 1: Engineering queue (`/queue/engineering`)

**Who sees it:**
- EngLead: the whole queue.
- Engineer: "My assignments" plus the read-only queue.
- Leadership: read.

**Contents:** every quote in `ENG_REVIEW`, plus quotes that passed G1 and are awaiting acceptance.

**Columns:**
- tier chip + score
- quote number
- opportunity / account
- product family / resin / volume
- KAM
- **time in queue** (since entering ENG_REVIEW)
- **time since assignment**
- assigned engineer
- drawing status
- completeness warnings
- SF close date

**Default sort:** pinned (queue_position override) → tier → score desc → oldest first. The user can re-sort, filter (tier, engineer, unassigned, aged > N days, product family) and search.

**Aging buckets:** < 3 business days, 3–10, > 10. The 3-day value is Jim's unwritten target; it's a config value, **not an SLA** (D-20). Show the counts as header chips.

**Actions** (EngLead):
- **Assign / reassign** (engineer picker of `CCQ.Engineer` + `CCQ.EngLead` users, showing each engineer's current open count):
  - writes `assigned_engineer_id`, `activity_event` and `audit_event`, and notifies the engineer
  - multi-select bulk assign
- **Accept** (start review): records `accepted_at`.
- **Return to KAM**: a G2 "Rework" outcome with a required reason code and a note listing the missing information. The quote goes back to the KAM's drafts with a banner.
- **Pin to top**: a queue_position override (B-09; self-applied, logged).

**Alert on arrival:** when a quote enters ENG_REVIEW, notify every user with `CCQ.EngLead` (in-app now; email in B-18). This is P0 per the 10/14 sync, even though the PRD lists notifications as P1 (X-91).

**Backup assigner:** setting `eng_queue_backup_assigner_user_ids` lets another user act as EngLead for assignment when Jim is out (risk R-04).

## Part 2: Engineering Review form (on quote detail, tab "Engineering")

Editable by the assigned engineer and EngLead while in ENG_REVIEW; read-only for others. Commercial fields are redacted per policy.

- **Solution:**
  - process type (value list: EBM, RHB, IBM, IMM, IMM Preform, ISBM, Assembly, Other)
  - machine type (value list, provisional)
  - **plant/site** (value list). The site is decided by Engineering + Ops + Supply Chain, never by the KAM (DF-10).
  - cavitation
  - cycle time (s)
  - tooling notes (mold/hot runner)
  - downstream equipment notes (air, water, electric, inspection/leak detection; DF-37)
  - **preliminary capital USD** *(commercial)*
  - technical concept notes
- **Capacity evidence** (repeatable rows, CR-19; at least one required for "Proceed" outcomes):
  - site
  - line/asset
  - **assumed effectiveness %** (no default; required, with helper text "State your assumption. Quotes have historically assumed 85% vs ~70% demonstrated (DF-22)")
  - cycle time (s)
  - utilization %
  - buffer %
  - analysis date
  - analyst (user)
  - notes
- When the capital estimate is saved, re-run priority scoring (capital exposure attribute).

## Part 3: G2 Feasible solution? (generic gate dialog; decider EngLead)
Outcomes, from the 9/15 interim one-pager (provisional config):
- **Proceed**: requires solution fields + ≥ 1 capacity row. Goes to QUOTING.
- **Proceed with risk**: same requirements + a risk note. Goes to QUOTING.
- **Capital required**: requires a preliminary capital figure. Goes to QUOTING and sets `capital_readiness=pending` on the pricing record (B-11).
- **Hold**: review date + reason.
- **Rework**: reason + note. Returns to the KAM.
- **Stop**: reason code + note. Closes as DECLINED.

The evidence snapshot stores the solution and capacity rows as they were at decision time.

## Part 4: Time-in-stage
`GET /quotes/:qn/stage-times` returns per-stage durations, excluding holds (domain `computeTimeInStage`). Show them as a small horizontal bar on quote detail. The same function feeds B-17.

## API
- `GET /queue/engineering?filters`
- `POST /quotes/:qn/assignment`
- `POST /quotes/:qn/eng-review/accept`
- `PUT /quotes/:qn/eng-review`
- `PUT /quotes/:qn/capacity-evidence`
- G2 decisions go through the generic gate route.

Register all routes in the permission-matrix tests (Engineer may edit only quotes assigned to them; test that).

## Tests
- Queue ordering; aging buckets with a frozen clock; bulk assign.
- Engineer can't edit unassigned quotes; KAM gets 403 on editing; KAM sees capital redacted.
- G2 required-field enforcement for each outcome; "Capital required" sets readiness pending.
- Playwright: EngLead assigns → Engineer completes the review with capacity evidence → Proceed.

## Acceptance
- [ ] Jim's queue shows everything with aging and alerts; assignment is recorded
- [ ] Engineering Review + capacity evidence + G2 work end to end
- [ ] Ready for **R2 (Thu Oct 29)** with Jim Zweifel, Faron Ipox and Jeffrey Pitrak
- [ ] Tick B-10 in `docs/build-guide/03-build-steps.md`, recording R2 feedback
