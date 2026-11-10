# Session 5: Cross-cutting checks and end-to-end journeys

Read `00-common.md` first. Scope name for the report and branch: `cross-cutting`.

**Scripts:** `docs/uat/scripts/security-access.md` (all steps), and `docs/uat/scripts/tie-out.md` for what can be
done against the fake Salesforce reader only (say which steps are not testable locally). This session uses
**every persona**. It is the most security-minded: you are authorised to probe the **local synthetic app**
the way an attacker would, and nothing else.

## 1. Permission matrix (all roles plus "no role")

- Use `docs/security/route-inventory.md`. For each of the ten roles and a persona with no role, call **every
  route** that changes data, and a sample of every read route, as the role. Record allowed and denied.
  Denied means a `problem+json` 403 (or 401 for no identity), never a 200 and never a 500.
- The matrix test already exists in CI. Do not copy its result: test **combinations** it does not, such as
  the right role on someone else's quote (`kam-owner`, `engineer-owner`), the right role at the wrong stage,
  and a role that has the permission only in one stage (the approver at Final Review, the assigned engineer).
- **Row-level security:** connect as the app's database login and as the owner-scoped login and confirm what
  the security script describes (a KAM scoped to "owner" cannot read another owner's quote by raw SQL; the
  audit table refuses `UPDATE`, `DELETE` and `TRUNCATE`). Read only.
- Every role sees pricing, margin and capital figures that it can read (CLAUDE.md rule 2). Confirm no screen
  or API response redacts a figure for a role that can read the quote, and that no role can **write** a field
  it then cannot read back.

## 2. Hostile input (local only)

- **Stored XSS:** put `<img src=x onerror=alert(1)>` and `"><script>` in every free-text field you can find (intake, notes, comments, report an issue, admin values). It must render as text everywhere it appears, including emails and CSV.
- **CSV injection:** a value starting with `=`, `+`, `-` or `@` in any exported field must not execute in a spreadsheet (check the CSV exports: pipeline, capacity evidence).
- **Search and filters:** `'`, `%`, `_`, `\`, very long strings, and unicode in every search box and URL parameter. No 500, no unexpected rows.
- **Uploads:** a renamed executable, an HTML file named `.pdf`, a zero-byte file, a very large file, a name with `../`, quotes and unicode, the same file twice. Check the allowed formats, the size limit, the refusal messages and that downloads come back with a safe content type and name.
- **IDs in URLs:** change a quote number, attachment id or user id in the URL or API call to one you should not reach.
- **Mass assignment:** send extra JSON fields (`role`, `status`, `ownerId`, `approvedBy`) on create and update calls. They must be ignored or refused.

## 3. Audit, timeline and notifications completeness

- Run every journey below and, after each, list the audit events and timeline entries. Every stage change, gate decision, override, upload, export and **view** of a quote must have an event with the right actor and time. Note gaps and duplicates.
- Notifications: each hand-off, return, hold, closure and comment tells the declared people once each, in the app and by email with a working link; the actor is not told; no email repeats comment text.

## 4. End-to-end journeys (switch persona at each step)

| ID | Journey |
|---|---|
| J1 | Intake → G1 advance → assign engineer → Engineering review (BOM, capital required) → lead decides G2 → pricing assign → costing → ROI (Finance) → Price approved → Final Review (confirm capital terms) → G4 approve → customer decision Awarded → G6 hand-off → Closed – Won |
| J2 | Engineering returns the quote to the KAM with a reason; the KAM fixes and resubmits |
| J3 | Pricing sends the quote back to the KAM (G3); the KAM answers the scope question and resubmits; the steps reopen |
| J4 | Hold with a review date and owner; the owner is told; resume |
| J5 | Priority override by a sales leader; a KAM is refused |
| J6 | Lost with each reason code; Expired; a closure owner changed by a sales leader |
| J7 | A non-standard payment term: exception request → pricing lead rejects → blocked at G4 → approves → release |
| J8 | Customer-funded quote with the extra approval switched on: sales leader, then leadership, then the approver; switch it off after |
| J9 | An old quote whose plant, machine type or market is now retired: it opens and shows "(no longer offered)"; a new write is refused |
| J10 | Two users editing one quote at once: the second save is handled without losing the first user's data |
| J11 | Concurrent decision: two approvers decide the same gate; exactly one decision is recorded |

## 5. Sweeps

- **Accessibility:** axe on every route for every role (desktop and mobile); keyboard-only through J1 as the KAM.
- **Mobile 390 px:** every route, no horizontal scroll, tap targets.
- **Performance smoke:** with the synthetic data set (about 100 opportunities), the pipeline board and list, analytics and a quote page each load in a few seconds; note the slowest three. `pnpm load:smoke` (k6) only if k6 is installed.
- **Errors:** 404 page, a 403 page in the UI, API errors are RFC 9457 `problem+json` with a useful `detail`, no stack traces, no database error text in any response.
- **Time:** dates and times in US Central. Check a record created near midnight UTC and a date across the November 1 clock change.
- **Browser:** Chromium is enough; if WebKit and Firefox are installed in Playwright, run the J1 first screens in them and say so.
- **Session and navigation:** Back and Forward through the wizard, refresh on every page, open a link to a quote in a new tab as a role without access.

## Output

In addition to the standard report, add a **"Matrix results"** table (role × route group: allowed and denied,
and any mismatch) and a **"Journeys"** table (J1 to J11: Pass, Fail, Blocked, with the step where it failed).
