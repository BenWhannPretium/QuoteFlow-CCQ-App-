# QuoteFlow v1.0 release notes (draft)

**Status: DRAFT, 2026-10-27. Target release: Fri 2026-11-13 (U6 sign-off).** Update at U6 with what passed UAT and what is live. Per-role wording follows the quick-starts in `docs/uat/quickstart/`.

QuoteFlow is Pretium's Commercial Capital Quoting (CCQ) app. It replaces the legacy ERF application for **new-business** quotes that need engineering input and/or capital. Every quote is one governed record, linked to its Salesforce opportunity, numbered `CCQ-YYYY-NNNNN`.

Sign in at **TBD (prod URL, B-22)**. During UAT: `https://quoteflow-test.azurewebsites.net`. Sign in with your Pretium Microsoft account. What you see depends on your `SG-CCQ-*` group.

---

## The quote's path

1. **Intake** (KAM) → **G1 Qualify & prioritize** (sales leader)
2. **Engineering Review** (engineering lead and engineers) → **G2 Feasible solution?**
3. **Quoting** (Pricing) → **G3 Price approved & capital ready**
4. **Final Review** (approver) → **G4 Release proposition**
5. **Customer Decision** (KAM) → **G5** customer outcome
6. **Commit & Hand Off** (KAM) → **G6**, which closes **Closed – Won**

Every gate offers the standard outcomes where they apply (Advance, Hold, Rework, Redirect, Stop), each with an ⓘ definition. Labels and rules are configuration and still **provisional** (see Known limitations).

## What's new, by role

**KAM**
- Start an intake from your Salesforce opportunity in four steps. One quote per opportunity.
- Drafts save on their own. Attach drawings, or add a photo from your phone.
- See returned quotes with the reason, fix and resubmit under the same number.
- **My proposals**: validity countdown, then record the customer's answer (Awarded, In negotiation, Lost, No response / Expired, On hold, Re-quote).
- After Awarded, complete **Commit & Hand Off** (CER reference and receiving team) to close Won.
- Flag a quote as capital-likely; check the commercial terms; raise an escalation.

**Sales leader**
- **To qualify** list, highest priority first; record G1 with a reason.
- Approve or reject priority overrides; revert from the timeline.
- Team pipeline, proposals past validity with no outcome, analytics.

**Engineering lead**
- One engineering queue sorted by tier, score and age, with aging buckets. Alert on arrival.
- Assign, bulk-assign and reassign; return incomplete intakes to the KAM; pin a quote to the top (logged).
- Capacity sign-off and the G2 decision. Engineering analytics view.

**Engineer**
- **My assignments**, with an alert when work is assigned.
- Record the solution (process, machine, plant, cavitation, cycle time, preliminary capital) and capacity evidence (no OEE default).
- Capital and capacity figures can be entered but not read back (commercial fields).

**Pricing and pricing lead**
- Pricing queue. The pricing lead assigns and reassigns pricers.
- Record the price **approval** (who, when, basis, range), the costing attestation and capital readiness. No price figures are typed into QuoteFlow.
- Pricing history panel from the retired pricing app (ERF and SPR on the quote; BPR on the Pricing history page).
- Decide G3.

**Final Review approver**
- One-page review and a sticky decision bar; works on a phone.
- Advance releases the offer and sets the issue and valid-until dates. It does not award the quote.

**Leadership**
- Read everything, including pricing and capital figures.
- Analytics: pipeline, outcomes (win rate always beside capture rate), cycle time, flow, reasons, quality and governance, priority, adoption.
- Override log, audit log, audited CSV export.

**Admin**
- Admin console: value lists, reason codes, workflow labels and rules, app settings, scoring model versions, user scope. Every change needs a reason and goes to the decision log.
- Integrations page (Salesforce sync and full re-sync, pricing-history import, Fabric mirror check), feedback triage, audit and usage reports.

**Everyone**
- Notification bell, plus email for the events in the P0 table (once email is live). Per-user email opt-out.
- **Report an issue** from the user menu or any page footer.
- Help: a one-page quick-start per role, linked from each home screen ("New here?").

## What changed from the ERF app

- Every quote starts from a Salesforce opportunity (DEC-12). QuoteFlow reads Salesforce; it never writes back.
- The KAM enters only what Sales can know. Engineering picks the plant and the engineer. The priority score is calculated and advisory.
- No customer-account creation at intake: a new customer is marked **Not yet established** (DEC-27).
- Qualification, feasibility, price approval and release are **recorded decisions** with reasons, not emails.
- Capacity evidence and the capacity sign-off are part of the G2 record.
- Price approval is a record of who and when; price figures stay with Pricing. BPR is retired; the legacy ERF # is optional.
- Final Review is separate from the customer outcome. "No response" is not a loss.
- A quote closes only with an outcome, a reason, an owner and a date. A win closes only after Commit & Hand Off.
- Overrides need a justification, keep the original value and can be reverted.
- Pricing, margin and capital figures are stripped on the server for roles that may not see them.
- Every view, change, decision, upload and export is audited.
- Business rules are configuration, editable by an Admin with a reason, not code.

## Known limitations at v1.0

**Provisional configuration.** These ship as seeded values marked `provisional`, pending the owner's decision (`04-decisions-and-risks.md` §2). A different label is not a defect; a wrong meaning is.
- Intake field set and blocking fields (D-05)
- G1 decider and value/volume warnings (D-06)
- Scoring attributes, weights and tiers (D-19)
- Override approvers (D-OA)
- G2 / G3 / G4 / G5 / G6 outcome rules; capacity sign-off owner (D-07)
- Final Review approver membership and tiers (D-10); `g4_tier_rules` off
- Outcome taxonomy, reason codes, closure owner (D-15)
- Validity default 30 days, warning at 7 (D-12); no revalidation without a re-quote
- KAMs see peers' priority scores (D-K1)
- Pricing pass-through off (D-24); Legal review triggers all on (D-25)
- CER and Stage 6 owners (D-26); capital-likely and Market Development notices have no recipients (D-27)
- Escalation routes; no Process Owner named (D-28, D-02)
- Engineering aging buckets 3 / 10 business days, not an SLA (D-20); Pricing borrows them
- Gate owners are set in code, not in the admin console (`03` B-19)

**Integrations** (state on 2026-10-27; update at U6, see `05` §5):
- Salesforce: live on the production org. Field meanings still to confirm (Zac Cairns / Graham Parle).
- Pricing history: import built; not yet imported in test or prod.
- SharePoint: not connected; attachments go to Azure Blob storage until M7. Files don't move when the mode changes.
- Email: built; off until the shared mailbox and `Mail.Send` are granted (M7). In-app notifications work.
- Fabric mirror (L-8): code ready; mirror not running. A prod mirror may start in hypercare week 1 (D-FB5).
- Ranger AI, Salesforce write-back, CER integration: not in MVP.

**Known gaps from the UAT pack** (`docs/uat/README.md`):
- The Analytics page does not show the "operational, not certified" label (Usage report and ERF linkage do).
- The quote page does not show the Salesforce opportunity id (the tie-out reads it from Admin → ERF linkage).

**Other:**
- Dashboards are operational metrics, not D&A-certified.
- "Age" on the board and list is calendar days in stage; the engineering queue uses business days. No holiday calendar.
- The rate limit is per client IP (300/min), so many users behind one office address share it. A per-user limit is in progress.
- Monitoring is App Service health checks and in-app Admin alerts; App Insights telemetry and alerts are not wired yet.
- The 7:00 AM "to qualify" digest also goes on weekends.

## UAT results

To fill at U6 from the signed tables in `docs/uat/scripts/*.md` and `test-results.md`.

| Session | Scope | Result | Conditions / open defects |
|---|---|---|---|
| U1 | KAM, sales leader | TBD | TBD |
| U2 | Engineering lead, engineers, capacity | TBD | TBD |
| U3 | Pricing, approver, leadership | TBD | TBD |
| U4 | IT security / access | TBD | TBD |
| U5 | Tie-out: Salesforce, pricing, Fabric | TBD | TBD |

Defects at release: Sev-1 TBD · Sev-2 TBD · Sev-3 TBD · Sev-4 TBD (from `pnpm uat:defects`).

## Support

Embedded Intelligence supports QuoteFlow (`runbook.md` §8). Product questions: Bailey Schmitt. Access: Tre Curry. Problems: **Report an issue**.
