# B-23 · UAT pack, in-app feedback, training aids

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `docs/build-guide/02-schedule-and-meetings.md` (UAT U0–U6) and `03-build-steps.md`. Bailey runs the UAT sessions; Ben fixes. Gate 5 needs a test plan, results, a defect log and UAT sign-off. The PRD's adoption plan wants role-based onboarding and per-field explanations.

## 1. In-app feedback
- A "Report an issue" button in the user menu and on every page footer. It opens a dialog with type (bug / confusing / missing / idea), severity (1–4), description and an optional screenshot (using the browser screen capture API where available, otherwise file upload).
- Context is captured automatically: route, quote number, app version, role and browser.
- Stored in a new `feedback` table (migration) and visible in `/admin/feedback` with status (new / triaged / fixing / fixed / won't fix), an owner and a link to a GitHub issue.
- A "Create GitHub issue" admin action uses `gh`-compatible markdown in the clipboard. No GitHub API token in the app.

## 2. UAT scripts (`docs/uat/scripts/*.md`)
One per role, written as numbered steps with expected results, using **real prod opportunities** chosen by Bailey (placeholders until then):
- `kam.md`: intake from an SF opportunity (with and without a drawing), ship-to override, rework after a return, record Awarded + hand-off, record Lost with a reason, mobile intake.
- `sales-leader.md`: G1 all outcomes, priority override approve/revert, team dashboard.
- `engineering.md`: queue triage, assign/reassign, accept, return to KAM, Eng Review + capacity evidence, G2 outcomes, attachments.
- `pricing.md`: pricing queue, pricing context, price approval record, capital readiness, G3, redaction check (log in as a KAM and confirm no figures).
- `approver.md`: G4 approve on a phone, decline with a note, return.
- `leadership.md`: analytics definitions, override log, export.
- `security-access.md` (for U4 with IT): role matrix spot checks, direct-URL access attempts across scope, export redaction, audit-log verification.
- `tie-out.md` (for U5): 20 quotes compared against Salesforce and the pricing app.

Each script ends with a sign-off table (tester, date, pass/fail per step, comments).

## 3. Quick-start guides (`docs/uat/quickstart/*.md`, plus printable HTML)
One page per role:
- what QuoteFlow is for you
- your home screen
- the 3–5 actions you'll do
- what changed from the ERF (e.g. "You no longer pick plant or priority")
- who to ask

Link them from the landing dashboard ("New here?") per role.

## 4. Defect triage
- A `docs/uat/defect-log.md` generated from the `feedback` table via `pnpm uat:defects`.
- **Severity rules:** Sev-1 blocks a core flow; Sev-2 wrong data/permission; Sev-3 usability; Sev-4 cosmetic.
- **Rule:** Sev-1/2 fixed by Thu Nov 12; Sev-3/4 go to the P1 backlog unless trivial.
- **Daily during UAT:** a 15-minute triage (Bailey, Ben, Tre) at 4 PM.

## Acceptance
- [ ] Feedback button live in prod; admin triage page works
- [ ] All scripts and quick-starts written and reviewed by Bailey by Fri Nov 6
- [ ] Defect log maintained daily during UAT
- [ ] Tick B-23 in `docs/build-guide/03-build-steps.md`
