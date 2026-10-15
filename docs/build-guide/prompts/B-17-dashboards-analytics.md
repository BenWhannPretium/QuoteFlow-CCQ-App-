# B-17 · Role dashboards and operational analytics (F-02 complete, F-17 subset, CR-55/56/57)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `01-architecture.md` §3 and §9. Load the `dataviz` and `pretium-design` skills if they're available, for chart colours and layout. PRD F-02: "Dashboard organized by role: KAM sees own pipeline + intake CTA; Engineering sees queue; Pricing sees Quoting queue; Leadership sees portfolio + analytics." Darren called the 10/14 demo analytics "very generic". Make these **decision-useful and honest about data quality**.

## Global rules
- Every metric states its definition (info tooltip) and time window.
- A footer on analytics pages: **"Operational metrics from QuoteFlow; not yet D&A-certified."** Certified models come post-MVP via Fabric (Brennan Paul).
- Win rate is shown **only together with** the outcome capture rate (S-06/S-07 pairing), because a win rate on 29% captured outcomes misleads.
- Cycle times exclude recorded customer holds (CR-57).
- Every number is computed server-side from `stage_history` / `gate_decision` / `quote`, never in the browser.

## Landing dashboards (`/`, chosen by primary role; a user with several roles gets tabs)

1. **KAM**
   - "New intake" CTA.
   - My drafts (resume).
   - **Returned to me** (rework items with reasons).
   - My active quotes by stage (mini board).
   - Proposals expiring in ≤ 7 days.
   - My outcome capture rate.
2. **SalesLeader**
   - To-qualify (G1) count + list.
   - Pending override requests.
   - Team pipeline by stage.
   - Quotes lacking outcomes past validity.
3. **EngLead / Engineer**
   - Queue health: total, unassigned, aging buckets (< 3 / 3–10 / > 10 business days).
   - Per-engineer open load.
   - Median time-to-assign and assign-to-G2 (last 30 days).
   - Items returned to the KAM, with reasons (top 5): an information-quality signal.
4. **Pricing**
   - Quoting queue count + aging.
   - Capital-readiness pending.
   - Median time in Quoting.
5. **Approver**
   - Pending G4 with age.
   - Decided in the last 30 days.
6. **Leadership** (also `/analytics` for anyone with `analytics.read`):
   - **Pipeline:** count and SF amount by stage (bar). Amount is labelled "SF opportunity amount (as entered)".
   - **Cycle time:** median and p75 days per stage, plus end-to-end intake → G4 (S-01/S-02), trended weekly.
   - **Flow:** created vs closed per week; WIP by stage over time.
   - **Outcomes:** capture rate; win rate on decided quotes (count and amount) by market, product family and KAM; loss reasons (Pareto).
   - **Quality and governance:**
     - first-pass intake completeness: % reaching G2 without a Rework (S-03)
     - G1 qualification yield by outcome (S-04)
     - override frequency by field and approver
     - % of issued proposals with G1–G4 decisions recorded (gate compliance, S-08)
   - **Priority distribution:** count by tier; tier vs actual time-to-assign (is the queue honouring priority?).
   - **Adoption:** weekly active users by role, intakes created in QuoteFlow (S-10, from the audit log).

   Filters: date range, market, product family, KAM, region. Drill-down to the filtered quote list (B-14 URL).

## API
- `GET /api/v1/dashboards/:role` (summary blocks)
- `GET /api/v1/analytics/*` (one endpoint per chart, using SQL views or materialized views refreshed every 15 min by a job)
- Permission `analytics.read` for the leadership views; role dashboards are scope-filtered.

Put the SQL in `packages/db/sql/analytics/*.sql` as views. **D&A will reuse these definitions at M6**, so add a comment on each view with its business definition.

## UI
Recharts with the Pretium palette (green ramp for sequential data, copper for emphasis or alerts), using small multiples rather than dual axes. Every chart has an accessible table toggle and works at 390px (stack vertically). Use empty states with guidance when data is thin (early pilot).

## Tests
- SQL view tests with deterministic synthetic data: known answers for median time-in-stage with holds, capture rate, win rate (decided only) and first-pass completeness.
- Authz: KAM can't call leadership analytics; scope applies to KAM dashboards.

## Acceptance
- [ ] Each role lands on a useful dashboard
- [ ] Leadership analytics cover pipeline, cycle time, outcomes + capture rate, quality/governance, priority and adoption, each with definitions
- [ ] Ready for **R3 (Nov 5)**. Validate definitions with D&A (M6 output).
- [ ] Tick B-17 in `docs/build-guide/03-build-steps.md`
