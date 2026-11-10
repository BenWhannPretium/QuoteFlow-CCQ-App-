# AI dry-run UAT: shared brief (read this first, then your session file)

**What this is.** A thorough pre-pilot test of QuoteFlow, run by Claude Code against a **local copy** of the
app, role by role, feature by feature. The pilot group's UAT runs **Nov 13 to Nov 20, 2026**. This dry run
exists so the pilot users meet as few defects, wrong labels and broken scripts as possible.

**What it is not.** It does not replace business UAT or sign-off. Gate owners and pilot users decide whether
QuoteFlow is acceptable. Never write "UAT passed" or "ready for sign-off". Report what you saw.

Sessions: `01-kam-sales-leader.md`, `02-engineering.md`, `03-pricing-finance.md`,
`04-approver-leadership-admin.md`, `05-cross-cutting-and-journeys.md`. Each is independent and opens its own PR.

## Hard rules

1. **Test only.** Do not change application code, migrations, seeds, config, tests or workflows. The only
   files you may edit are the UAT scripts and quick-starts in `docs/uat/` where the script is wrong (see
   "Script corrections"), and your own report. Every code defect is **reported**, not fixed.
2. **Local and synthetic only.** `AUTH_MODE=dev`, `SF_MODE=fake`, a local Postgres, a local mail sink. Never
   connect to the Azure test or prod sites, Salesforce, SharePoint or Fabric. No real customer data, no
   secrets, no tokens (CLAUDE.md rule 8).
3. **Honest results.** Mark **Pass** only for something you saw work in the running app. Do not infer a pass
   from reading code or from a passing CI run. If you could not run a step, mark it **Blocked** or **Not
   tested** and say why. A report with gaps that it admits is useful. A report that looks complete and isn't is harmful.
4. **Confirm before reporting.** Repeat a failure once from a clean state. Note if it is intermittent.
5. **No GitHub issues, no comments.** The only GitHub output is one draft PR with your report.
6. **Keep evidence out of git.** Screenshots, traces and videos go in your scratchpad directory. Name them in
   the report. Do not commit them.

## Setup (local)

1. Read `CLAUDE.md`, `docs/uat/README.md`, and the scripts for your session in `docs/uat/scripts/`.
2. `git fetch origin main` and branch `claude/uat-dry-run-<scope>` from `origin/main`. Record the commit SHA.
3. Node 22 (`node -v`). If the machine has another major version, use `npm_config_engine_strict=false`, and
   say so in the report. `pnpm i`.
4. Postgres 16 with user, password and database all `ccq` (see `docker-compose.yml`). Use
   `docker compose up -d db mailpit` if Docker works. If not, install and start a native Postgres 16 and a
   mail sink (a small SMTP listener on port 1025 that writes messages to files is enough; or read the
   notification rows in the database and say email was not tested).
5. Copy `.env.example` to `.env` (leave `AUTH_MODE=dev` and `SF_MODE=fake`).
   `pnpm db:migrate && pnpm db:seed --synthetic`, then `pnpm dev` (web on `:5173`, API on `:3000`).
6. Browser: Playwright and Chromium are pre-installed. Use `require('playwright')` and `chromium.launch()`.
   **Do not run `playwright install`.** Write throwaway scripts in your scratchpad directory, never in the repo.
   Desktop 1280×800, mobile 390×844. Use `deviceScaleFactor: 1`.
7. Personas: the dev role switcher in the app, or set `localStorage['ccq.devPersona']` to a key from
   `packages/db/seeds/synthetic/personas.ts` (`kam`, `kam-owner`, `kam-region`, `sales-leader`, `eng-lead`,
   `engineer`, `engineer-owner`, `pricing`, `pricing-lead`, `finance`, `approver`, `leadership`, `admin`,
   `multi-role`). `apps/web/e2e/personas.ts` says what each should see.
8. **Quotes.** Create your own quotes through the UI as the right roles (that is itself a test of intake and
   hand-offs). If reaching a stage that way would take too long, use a seeded synthetic quote at that stage
   and say so. Do not edit the database to move a quote.
9. The repo already has a Playwright suite (`pnpm e2e`). You may run it once as a baseline, but your job is
   what it does **not** cover: negative cases, other roles, edge cases, wording, hand-offs.

## What to test, for every screen and action in your scope

Work **breadth first**: do every step of your scripts in order, then go deeper.

1. **The script, verbatim.** Each step: what the script expects against what you see.
2. **Allowed role.** The action works and the result is right (data saved, status moved, the right next owner).
3. **Denied roles.** The UI hides or disables the action, with a reason where one is shown. Then try the same
   action directly against the API as the denied persona: it must be refused with a `problem+json` 403 (see
   `docs/security/route-inventory.md` for the routes and permissions). A UI that hides it but an API that allows it is a **Sev-2**.
4. **Validation.** Empty, too long (the 120, 200 and 500 character caps), wrong type, zero, negative, and
   boundaries. Error messages say what is wrong and where.
5. **State.** Sections lock after G2, G3 and G4. A send-back reopens them. A hold, a withdraw and a re-submit
   behave. Nothing can be edited that should be locked, by UI or API.
6. **Audit and timeline.** Each action writes an `audit_event` and a timeline entry with the right actor, time
   and detail. Read them in the UI, or with read-only `psql`. Never update or delete audit rows.
7. **Notifications.** The right people are told, once each, in the app and by email, with a working link. The
   actor is not told. Email never contains comment text.
8. **Wording.** Typos, inconsistent terms (Color against Colour, ERF never "ERS", "Price approved" as the G3 label),
   unexplained jargon, labels that disagree with the scripts or quick-starts.
9. **Accessibility.** Run axe-core on every screen you visit (pattern in `apps/web/e2e/axe.ts`). Do the main
   flow of the role by keyboard only. Check labels, focus order and visible focus.
10. **Mobile.** At 390 px: no horizontal scroll, controls are tappable (44 px), nothing is cut off.
11. **Robustness.** Reload mid-flow, double-click submit, browser Back, two tabs open on the same quote (one
    saves first), a very long text, special characters (`'`, `"`, `&`, `<`, emoji, accents), blank spaces only.
12. **Display.** Dates in US Central, money formatted, empty states make sense, lists with 0, 1 and many rows.

## Known gaps and provisional settings (do not report these as new defects)

Mention them only if they cause real confusion.

- **Not built:** the one-page cost summary (F-031); estimate-workbook fields (F-026); the sub-market filter on
  the pipeline and analytics screens; filtering the plant and machine-type pickers against each other;
  extraction of BOM figures.
- **Off until an Admin turns them on** (turn on to test, turn **off** when you finish): the extra
  customer-funded Final Review approval (`g4_additional_approvals`), the platform-minimum warning
  (`intake_guardrails`) and volume-band routing (`g1_volume_routing`). The draft scoring model v3 is inactive.
- **Provisional config.** Stage, gate and reason-code names, lists marked provisional, payment terms
  (Net 15 and Net 30 standard), the exception approver (pricing lead). A different wording is not a defect; a
  wrong meaning is.
- **Known wording gaps:** the one-page BOM tab is named **CER BOM** in the template but "CSR BOM" in the app
  and scripts; the Engineering tab's "From the intake" block shows only resin, market, neck, PCR, color,
  additives and variants; there is no fixed wording for the refusal when capital terms are not confirmed.
- **Cannot be tested locally:** Microsoft sign-in, Azure, Fabric, SharePoint, live Salesforce. Say "not tested".

## Severity (same as `docs/uat/README.md`)

| Severity | Means |
|---|---|
| **Sev-1** | Blocks a core flow: cannot submit an intake, decide a gate, or use a screen |
| **Sev-2** | Wrong data or permission: a figure is wrong, a role can do what it should not, a decision is allowed that should not be |
| **Sev-3** | Usability: a label is unclear, too many clicks, a confusing message |
| **Sev-4** | Cosmetic: alignment, spelling, colour |

If unsure, pick the higher one.

## Script corrections

If a script step is **wrong** (wrong label, wrong step number, wrong expected result, a step that cannot be
done as written), fix the script and its quick-start in `docs/uat/`, keeping step numbers stable, and list
each correction in the report. If the **app** is wrong, do not touch the script; report a defect.

## Report

Write `docs/uat/dry-run/<YYYY-MM-DD>-<scope>.md` with:

1. **Header:** date, commit SHA, Node version, how the database and mail sink ran, which personas, and what you did not cover.
2. **Summary:** one paragraph, and counts by severity. No "ready" or "approved" language.
3. **A. Coverage:** a table of every script step in scope: `Step | Role | Result (Pass / Fail / Blocked / Not tested) | Note`.
4. **B. Defects:** `DR-<scope>-NN | Severity | Where (route, role) | Steps (8 or fewer) | Expected | Actual | Evidence (file name) | Suspected cause (file path, only if obvious)`.
5. **C. Script corrections made.**
6. **D. Could not test, and why.**
7. **E. Observations:** things that are not defects but may confuse a pilot user.

Then commit only the report and any script corrections, push the branch and open a **draft PR** titled
`docs(uat): AI dry-run results: <scope>`, using the repo PR template (tick only what is true). End the PR
body with the generated-by line. Finish with a short chat summary: counts by severity, the three most
serious defects, and what you could not test. Do not merge.
