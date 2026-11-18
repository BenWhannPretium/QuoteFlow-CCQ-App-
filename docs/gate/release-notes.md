# QuoteFlow v1.0 release notes (draft)

> Checked against the build on 2026-11-17 (pre-release audit): FB-15 to FB-20 added (intake markers, Engineering & Capacity and the Production Scheduler, the four decision choices, the Command Center, multi-item quotes, the offer letter); figures are no longer hidden from any role; the prod URL, rate limit, monitoring and two closed UAT gaps corrected.

**Status: DRAFT, 2026-10-27. Target release: Fri 2026-11-13 (U6 sign-off).** Update at U6 with what passed UAT and what is live. Per-role wording follows the quick-starts in `docs/uat/quickstart/`.

QuoteFlow is Pretium's Commercial Capital Quoting (CCQ) app. It replaces the legacy ERF application for **new-business** quotes that need engineering input and/or capital. Every quote is one governed record, linked to its Salesforce opportunity, numbered `CCQ-YYYY-NNNNN`.

Sign in at `https://quoteflow-prod.azurewebsites.net` (prod, first deployed 2026-11-12, B-22). During UAT: `https://quoteflow-test.azurewebsites.net`. Sign in with your Pretium Microsoft account. What you see depends on your `SG-CCQ-*` group.

---

## The quote's path

1. **Intake** (KAM) → **G1 Qualify & prioritize** (sales leader)
2. **Engineering & Capacity** (engineering lead, engineers and the production scheduler; the stage was "Engineering Review" before FB-16) → **G2 Feasible solution?**
3. **Quoting** (Pricing) → **G3 Price approved** (FB-07: costing, then payback when capital is needed, then the pricing lead approves the price; capital readiness is its own field)
4. **Final Review** (approver) → **G4 Release proposition**
5. **Customer Decision** (KAM) → **G5** customer outcome
6. **Commit & Hand Off** (KAM) → **G6**, which closes **Closed – Won**

Every gate's decision dialog offers four choices where they apply (FB-17): **Advance**, **Send back to…** (a "Send to" list names where the quote goes; a reason and a note are required), **Hold** (reason, review date and owner) and **Stop**, each with an ⓘ definition. G5 keeps the customer's outcomes as a flat list. An Admin can switch an outcome off; G2 "Advance – capital required" is switched off, and capital is needed when Engineering's capital estimate is above the configured line ($0). Labels and rules are configuration and still **provisional** (see Known limitations).

## What's new, by role

**KAM**
- Start an intake from your Salesforce opportunity in four steps. A red asterisk marks every field needed to submit, and a refused submit lists each one with a Fix link (FB-15).
- One quote can hold several items (FB-19): add an item per product or variant, add items from the opportunity's Salesforce products, duplicate or remove them. Each item has its own product fields, volume and drawings. If the opportunity already has an open quote you are warned and may start a separate one (setting `opportunity_active_quotes`, provisional `warn`).
- Drafts save on their own. Attach drawings, or add a photo from your phone.
- See returned quotes with the reason, fix and resubmit under the same number.
- **My proposals**: validity countdown, then record the customer's answer (Awarded, In negotiation, Lost, No response / Expired, On hold, Re-quote).
- After Final Review releases the offer, generate the customer **offer letter** as a Word document from the quote (FB-20): one letter per quote, a row per item, prices read from the costing workbook and not editable. The wording is marked DRAFT until Legal approves it.
- After Awarded, complete **Commit & Hand Off** (CER reference and receiving team) to close Won.
- Flag a quote as capital-likely; check the commercial terms; raise an escalation.

**Sales leader**
- **To qualify** list, highest priority first; record G1 with a reason.
- Approve or reject priority overrides; revert from the timeline.
- Team pipeline, proposals past validity with no outcome, and the **Analytics** view of the Command Center.

**Engineering lead**
- One engineering queue sorted by tier, score and age, with aging buckets. Alert on arrival.
- Assign, bulk-assign and reassign; return incomplete intakes to the KAM; pin a quote to the top (logged).
- Assign an engineer and, optionally, a production scheduler. Capacity sign-off and the G2 decision (**Decide feasibility**); the lead can approve capacity inside that decision (FB-16). Engineering analytics view.
- FB-14: **Capacity at a glance** under each capacity row (theoretical, expected and practical parts per day and per year), read-only; utilization and G2 are unchanged.

**Engineer**
- **My assignments**, with an alert when work is assigned.
- Record the solution per item: the plant, then one **Process & machine type** pick limited to what that plant runs (the process follows from it), cavitation, cycle time and a budgetary capital estimate; upload the equipment BOM (required to advance when the estimate is above $0); and capacity evidence (no OEE default).
- Submit the finished review to the engineering lead, who decides G2 or sends it back with a note.
- Capital and capacity figures are readable by every role that can read the quote (decided 2026-10-30); only who may edit them is restricted.

**Production scheduler (FB-16, new role `CCQ.ProductionScheduler`, provisional)**
- **Capacity requests**: the quotes assigned to you. Enter the capacity evidence, then approve capacity or block it with a note. A block returns the work to the engineer and notifies them.
- Reads the solution; cannot change it. The Entra app role and group are still an IT action.

**Pricing and pricing lead**
- Pricing queue. The pricing lead assigns and reassigns pricers.
- Record the price **approval** (who, when, basis, range), the costing attestation and capital readiness. No price figures are typed into QuoteFlow.
- FB-07: upload the **costing model** (step 1). It is one record with version history; the latest is flagged. The costing attestation needs it on file.
- The pricing lead may upload an **updated price table** (optional) and approves the price: **G3 Price approved**. It needs the costing model and, when capital is needed ($0 CER included), Finance's payback model.
- Pricing history panel from the retired pricing app (ERF and SPR on the quote; BPR on the Pricing history page).
- The pricer submits to the pricing lead. Only the pricing lead decides G3 (**Decide price approval**).

**Finance (FB-07, new role `CCQ.Finance`)**
- Told when a quote needs a payback model (capital needed, $0 CER included) and Pricing has uploaded its costing model.
- Downloads the costing model and uploads the **payback model** (step 2, versioned). An input, not an approver. Reads quotes; changes nothing else.
- FB-14: after the upload, the Payback step shows a **summary** of the workbook's headline figures (incremental units, net sales and margin, P&L savings, capital request, payback, simple payback, NPV, IRR and the assumptions behind them), read from the file and not editable in QuoteFlow. An Excel error, a blank headline, a zero or negative payback, or a payback above the hurdle shows as a warning that never blocks. Pricing, the pricing lead and the Final Review approver see the same summary.

**Final Review approver**
- One-page review and a sticky decision bar; works on a phone.
- Advance releases the offer and sets the issue and valid-until dates. It does not award the quote.

**Leadership**
- Read everything, including pricing and capital figures.
- Analytics: pipeline, outcomes (win rate always beside capture rate), cycle time, flow, reasons, quality and governance, priority, adoption.
- Override log, audit log, audited CSV export.

**Admin**
- Admin console: value lists, reason codes, workflow labels and rules (an outcome can be switched off without losing its history, FB-17), app settings, scoring model versions, user scope. Every change needs a reason and goes to the decision log.
- Integrations page (Salesforce sync and full re-sync, pricing-history import, Fabric mirror check), feedback triage, audit and usage reports.

**Everyone**
- Home is the **Command Center** (FB-18): **My work** (your role's landing) and, for roles that may read analytics, **Analytics**. `/analytics` redirects there. Quotes on hold carry an **On hold** chip with the reason, the owner and the review date.
- "Progress saved" shows beside each Save button until the form changes; the Salesforce opportunity is a link wherever it shows, once an Admin sets the Salesforce URL.
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
- Costing, payback and price confirmation run in order inside Quoting (D-001). The costing and payback workbooks live on the quote with their versions, not in email.
- Final Review is separate from the customer outcome. "No response" is not a loss.
- A quote closes only with an outcome, a reason, an owner and a date. A win closes only after Commit & Hand Off.
- Overrides need a justification, keep the original value and can be reverted.
- Pricing, margin and capital figures are visible to every role that can read the quote (decided 2026-10-30). The redaction code stays in place but strips nothing today; who may edit or decide is unchanged, and which quotes a person can open is still limited by their data scope on the server and in the database.
- Every view, change, decision, upload and export is audited.
- Business rules are configuration, editable by an Admin with a reason, not code.

## Known limitations at v1.0

**Provisional configuration.** These ship as seeded values marked `provisional`, pending the owner's decision (`04-decisions-and-risks.md` §2). A different label is not a defect; a wrong meaning is.
- Intake field set and blocking fields (D-05)
- G1 decider and value/volume warnings (D-06)
- Scoring attributes, weights and tiers (D-19)
- Override approvers (D-OA)
- G2 / G3 / G4 / G5 / G6 outcome rules; capacity sign-off owner (D-07)
- FB-15 to FB-20 (`04` §2a): Market and Sub-market required at intake; the Production Scheduler role and its grants (D-008); the four choices, their labels and the capital line `capital_needed_above_usd` ($0); hold owner defaults to the stage's assignee; up to 20 items per quote and `opportunity_active_quotes` = `warn` (D-005); who may generate the offer letter and its wording (`offer_letter_wording_approved` false)
- Final Review approver membership and tiers (D-10); `g4_tier_rules` off
- Outcome taxonomy, reason codes, closure owner (D-15)
- Validity default 30 days, warning at 7 (D-12); no revalidation without a re-quote
- KAMs see peers' priority scores (D-K1)
- Pricing pass-through off (D-24); Legal review triggers all on (D-25)
- CER and Stage 6 owners (D-26); capital-likely and Market Development notices have no recipients (D-27)
- Escalation routes; no Process Owner named (D-28, D-02)
- Engineering aging buckets 3 / 10 business days, not an SLA (D-20); Pricing borrows them
- Gate owners are set in code, not in the admin console (`03` B-19)
- FB-14: the payback summary's cells are a proposal awaiting Finance (the template is a draft); the costing summary is off until the new costing template arrives; showing the figures (`model_summary_visible`) is on and still an open question; "Payback" (was "ROI") is Finance's wording

**Integrations** (state on 2026-10-27; update at U6, see `05` §5; lines marked 2026-11-17 were re-checked against `infra/` in the pre-release audit):
- Salesforce: live on the production org. Field meanings still to confirm (Zac Cairns / Graham Parle).
- Pricing history: import built; not yet imported in test or prod.
- SharePoint: not connected; attachments go to Azure Blob storage until M7. Files don't move when the mode changes.
- Email: built; off until the shared mailbox and `Mail.Send` are granted (M7). In-app notifications work. 2026-11-17: dispatch is off in test and prod (`notificationDispatchIntervalSeconds = 0`).
- Fabric mirror (L-8): code ready. A prod mirror may start in hypercare week 1 (D-FB5). 2026-11-17: a test mirror was proven on 2026-11-06 (`03` B-27); the prod mirrored database does not exist yet, and the Fabric ids are empty in both environments, so the app's mirror check and the deploy stop/start are off.
- Ranger AI, Salesforce write-back, CER integration: not in MVP.

**Known gaps from the UAT pack** (`docs/uat/README.md`), both closed in the code since:
- The Analytics view now shows "Operational metrics from QuoteFlow; not yet D&A-certified." (as the role dashboards do).
- The quote page now shows the Salesforce opportunity id ("SF opportunity ID" on the Intake card and in the header, a link once the Salesforce URL is set).

**Other:**
- Dashboards are operational metrics, not D&A-certified.
- "Age" on the board and list is calendar days in stage; the engineering queue uses business days. No holiday calendar.
- The rate limit is 300 requests a minute per signed-in user (per caller address only for public routes), on API requests only.
- Monitoring: App Service health checks and in-app Admin alerts. Prod also has an availability test and metric alert rules, but no receiver is set, so they notify nobody yet. The app sends no telemetry to Application Insights; its logs are in the App Service log stream only.
- Prod runs on an interim B1 App Service plan with one instance and no staging slot, until IT raises the P1v3 quota. A deploy restarts the site, and a rollback is a redeploy.
- Offer letter: the wording is unapproved (every letter carries a DRAFT line), and the price map for the real costing workbook layout is inactive until the new costing template arrives (`03` FB-20). Whether a letter can be generated from one of today's real workbooks was not checked (not verified from the source); the card lists what is missing when it cannot.
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
