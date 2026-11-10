# Session 4: Approver, Leadership and Admin

Read `00-common.md` first. Scope name for the report and branch: `approver-leadership-admin`.

**Scripts:** `docs/uat/scripts/approver.md` (all parts, including the optional Part G),
`docs/uat/scripts/leadership.md`, `docs/uat/scripts/priority-calibration.md`.
**Quick-starts:** `approver.md`, `leadership.md`, `admin.md`.
**Personas:** `approver`, `leadership`, `admin`, `sales-leader` (for the extra sign-off), `multi-role`
(sales leader and approver). Use other roles only to get quotes to Final Review.

## Features to cover

**Final Review (G4, approver)**
- The queue (`/approvals`); "The request" (intake, including Market › Sub-market and Other details); engineering and pricing read-outs; the three Quoting steps read-only.
- **Capital terms:** the approver edits and clicks **Confirm capital terms** (only an approver, only in Final Review). **G4 Approve needs them confirmed**, and any non-standard payment term needs an approved exception. A later change clears the confirmation. Releasing before confirming is refused: write down the exact wording the user sees.
- Open terms or Legal checks are warnings, not blockers (the script says which). A pending or rejected terms exception blocks release.
- Decisions: approve, decline, return (to whom, with a reason and note). Locks after G4. Notifications.
- **Extra customer-funded approval (off by default, F-082):** as Admin switch `g4_additional_approvals` on; for a customer-funded or $0 CER quote the approver's approval waits for the **sales leader, then leadership** sign-offs in that order; a wrong-order sign-off is refused; switch it **off** again at the end.
- Segregation: the person who decided an earlier gate on the quote is not allowed to approve it where the rules say so. Test with `multi-role`.

**Leadership (read-only)**
- Home, queues, pipeline and analytics are readable; every write is refused (UI and API). The Admin menu entry for Leadership is read-only: check it exposes nothing editable.
- Analytics: pick five numbers (counts by stage, capture rate, time in stage, a loss Pareto) and **check them against the database** with read-only SQL. Check the date filters, empty states, and the 390 px layout.

**Admin**
- **Config console:** stages and gates, reason codes, value lists (approve, mark provisional, deactivate: never delete), settings, notification settings, users and roles and scope. Every change needs a reason where the UI asks, creates a new version, and is audited. Provisional badges are shown. A change to a live value takes effect without a restart.
- **Scoring model (priority-calibration script):** live model v2; the inactive draft v3 (strategic fit by sub-market, 27 scored, three unscored: Histology, Tubes & Vials, Home Care › Non-Core); the **open-quote preview** (old tier, new tier, points moved, the driver; it writes nothing; until KAMs pick sub-markets every open quote previews at the neutral 50); activation is a separate, audited action with a required reason and a choice to rescore open quotes; discard; the previous version is kept. Do not activate v3 and leave it active: restore the state you found.
- **Feature switches:** `g1_volume_routing` and `intake_guardrails` (platform minimums: ISBM 1M, RHB 1M, Injection 3M, IBM 3M, EBM 1M a year) behave as the sales-leader script says and are switched back off.
- **Feedback inbox** (`/admin/feedback`): submit a report as another persona ("Report an issue": kind, severity, text, optional screenshot), then triage it as Admin (status, owner). Check the screenshot is visible only to admins.
- **Integrations:** the Salesforce sync status page with the fake reader (counts, last run, errors).
- **Audit:** the audit viewer if present; every Admin change appears.

**Permissions to probe as the wrong role (UI and API)**
- Leadership and Approver cannot open Admin write screens; Pricing and Finance cannot approve a gate; the KAM cannot see Admin.

## Cross-role checks you own

- A quote reaches Final Review with all earlier data intact and the capital terms pre-filled by Sales.
- After approval, the KAM can record the customer's decision (G5) and the hand-off (G6) works.
- Reason codes and closure owners are mandatory on every terminal path.
