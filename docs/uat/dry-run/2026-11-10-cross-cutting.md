# AI dry run: cross-cutting checks and end-to-end journeys (session 5)

## Header

| | |
|---|---|
| Date | 2026-11-10 (about 15:50 to 17:20 US Central), plus a retry on 2026-11-11 (about 09:30 to 10:30) after Docker came back, on the same database and commit |
| Commit | `4b018b682f061bf33270c93b0d134b2a58d0a3ec` (`origin/main`) |
| Node | **v24.22.1** (the repo wants 22). `pnpm i` ran with `npm_config_engine_strict=false`. The root scripts (`pnpm db:migrate`, `pnpm dev`) still fail on Node 24, because the nested `pnpm --filter` checks `engines` again. So I ran the package scripts directly: `tsx src/cli/migrate.ts`, `tsx src/cli/seed.ts --synthetic`, `tsx src/server.ts` and `vite --port 5205 --strictPort`. |
| Database | Postgres 16 in Docker (`ccq-uat-5`, host port 5505), migrated and seeded with `--synthetic` (14 personas, 102 opportunities, 150 quotes). I added about 30 quotes myself. |
| Mail sink | Mailpit v1.27 in Docker (`ccq-uat-mail-5`, SMTP 1105, UI 8105), `MAIL_MODE=smtp`. 213 emails were captured and read. |
| App | `AUTH_MODE=dev`, `SF_MODE=fake`, `FILESTORE_MODE=local`. API on :3105 and web on :5205, set through `.env` (git-ignored) and CLI flags only. `APP_BASE_URL=http://localhost:5205`. |
| Browser | Playwright 1.64 driving the **system Chrome 157** (`channel: 'chrome'`). The bundled Chromium is not installed, and the brief forbids `playwright install`. axe-core 4.14 with the WCAG 2.1 A/AA tags (the `apps/web/e2e/axe.ts` pattern). |
| Personas | All 14: `kam`, `kam-owner`, `kam-region`, `sales-leader`, `eng-lead`, `engineer`, `engineer-owner`, `pricing`, `pricing-lead`, `finance`, `approver`, `leadership`, `admin`, `multi-role`. "No identity" was tested as no header and as an unknown persona. |
| Not covered | Docker Desktop crashed at about 17:05 CST on Nov 10. On Nov 11 I restarted it and my two containers with their data intact (180 quotes, the scope and Admin switch as I had left them), and ran what had been blocked: the desktop UI/axe sweep for Approver, Leadership and Admin, the 390 px mobile sweep for all 10 roles, the UI double-click checks, the J7 and J9 screens, wizard navigation and the audit of refused calls. Still not covered: most journeys were driven through the API rather than clicked through the UI, and the full keyboard-only J1 (see D). Microsoft sign-in, Azure, Fabric, SharePoint and live Salesforce cannot be tested locally. |

Evidence (scripts, JSON outputs and screenshots) is in this session's scratchpad and is not committed: `lib.mjs`, `flow.mjs`, `matrix.mjs` → `matrix-out.json`, `combos.mjs`, `sec.mjs` and `sec2.mjs`, `hostile*.mjs`, `search.mjs`, `uploads.mjs` and `dl.mjs`, `mass.mjs`, `j1.mjs` to `j9c.mjs`, `j11r.mjs`, `j11g5.mjs`, `sweep2.mjs` → `sweep-desktop-*.json`, and the screenshots `kam-review.png`, `scoped-link.png`, `finance-quoting.png`, `tz-timeline.png`. The Nov 10 scratchpad was cleared when the session restarted. The Nov 11 retry's evidence is `sweep.mjs` → `sweep-desktop-approver+leadership+admin.json`, `sweep-mobile-*.json`, `uidbl.mjs`, `g4ui.mjs`, `uimore.mjs`, `wiz.mjs`, `audit403.mjs`, and the screenshots `dbl-dblclick.png`, `g4-click-CCQ-2026-00183.png`, `g4-dblclick-CCQ-2026-00184.png`, `j9-*.png`, `wizard.png`.

## Summary

The authorization model held under every probe I could run. I sent all 126 routes as each of the 14 personas, anonymously and as an unknown persona. Every denial was a `problem+json` 403 (or 401 with no identity). No denied role got a 2xx, and no route returned a 500 for a permission reason. Combination checks also held: the right role on someone else's quote, the right role at the wrong stage, owner- and region-scoped KAMs and engineers, Finance, the approver who is also the KAM, and the extra customer-funded sign-offs. Raw-SQL row-level security matched the security script, and `audit_event` refused UPDATE, DELETE and TRUNCATE as both the app role and the owner. Stored XSS payloads rendered as text on every screen I checked and never reached an email. CSV cells starting with `= + - @` are neutralised. Uploads check the content against the extension and are served as attachments with `nosniff`. Mass-assignment fields were stripped or refused.

The most serious finding is about concurrency. **Gate decisions are not serialised on the server.** Two approvals sent at the same moment, from two approvers or two tabs, both succeed. The quote then has two G4 decisions, two "Customer Decision" stage-history rows and duplicate notifications. An approve racing a decline recorded all of them, and the decline won. J11 fails. The UI does stop one person's double-click: in the G1 and G4 dialogs, a double-click on "Record decision" sends one request.

The other notable gaps:
- Intake does not check value-list codes on the server, so it accepts a retired market and made-up resin and market codes. J9 only half passes: the old quote does show "(no longer offered)".
- A NUL byte in text or search input returns a bare 500.
- A hold accepts a review date in the past.
- Refused (403) calls are not written to the audit log, though security step 33 expects them.
- At 390 px no page scrolls sideways (223 pages, 10 roles), but several common controls are smaller than 44 px.

Counts: **Sev-1: 0 · Sev-2: 2 · Sev-3: 9 · Sev-4: 1**. One script correction (security-access step 9).

## Matrix results

Each cell is `allowed / denied` for the route group: the number of routes the persona got past (any non-403 answer) and the number refused with a `problem+json` 403. Every persona was sent every route. Write routes got a real quote at a matching stage and an empty or invalid body, so allowed roles got 400/404/409/422 and nothing changed. Read routes ran for real.

| Route group | routes | kam | kam-owner | kam-region | sales-leader | eng-lead | engineer | engineer-owner | pricing | pricing-lead | finance | approver | leadership | admin | multi-role |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Admin audit / logs | 4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 4/0 | 4/0 | 0/4 |
| Admin config | 23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 0/23 | 9/14 | 23/0 | 0/23 |
| Admin other (users, integrations, feedback, reports, SF sync, pricing import) | 12 | 0/12 | 0/12 | 0/12 | 1/11 | 1/11 | 0/12 | 0/12 | 1/11 | 1/11 | 0/12 | 1/11 | 4/8 | 12/0 | 1/11 |
| Analytics / dashboards | 13 | 1/12 | 1/12 | 1/12 | 11/2 | 12/1 | 2/11 | 2/11 | 11/2 | 11/2 | 1/12 | 11/2 | 13/0 | 13/0 | 11/2 |
| Final Review / terms | 5 | 1/4 | 1/4 | 1/4 | 2/3 | 0/5 | 0/5 | 0/5 | 1/4 | 2/3 | 0/5 | 2/3 | 2/3 | 1/4 | 4/1 |
| Attachments | 4 | 3/1 | 4/0 | 4/0 | 3/1 | 3/1 | 4/0 | 4/0 | 3/1 | 3/1 | 2/2 | 2/2 | 2/2 | 3/1 | 4/0 |
| Quote read / comments / misc | 12 | 12/0 | 12/0 | 12/0 | 12/0 | 12/0 | 12/0 | 12/0 | 12/0 | 12/0 | 10/2 | 11/1 | 10/2 | 11/1 | 12/0 |
| Me / notifications / feedback | 7 | 7/0 | 7/0 | 7/0 | 7/0 | 7/0 | 7/0 | 7/0 | 7/0 | 7/0 | 6/1 | 7/0 | 7/0 | 7/0 | 7/0 |
| Gate decisions (route gate is `quote.read`; the service decides) | 2 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 |
| Overrides | 6 | 3/3 | 3/3 | 3/3 | 6/0 | 6/0 | 2/4 | 2/4 | 3/3 | 3/3 | 2/4 | 2/4 | 2/4 | 5/1 | 6/0 |
| Pricing history | 2 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 |
| Engineering | 11 | 2/9 | 2/9 | 2/9 | 2/9 | 10/1 | 8/3 | 8/3 | 2/9 | 2/9 | 2/9 | 2/9 | 3/8 | 4/7 | 2/9 |
| Pricing / Quoting | 9 | 1/8 | 1/8 | 1/8 | 1/8 | 1/8 | 1/8 | 1/8 | 4/5 | 8/1 | 2/7 | 1/8 | 2/7 | 5/4 | 1/8 |
| Outcome / hand-off | 2 | 2/0 | 2/0 | 2/0 | 2/0 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 1/1 | 2/0 |
| Intake (drafts, rework, SF search) | 10 | 10/0 | 10/0 | 10/0 | 9/1 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 9/1 | 9/1 |
| Exports | 1 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 0/1 | 0/1 | 1/0 | 1/0 | 0/1 | 1/0 | 1/0 | 1/0 | 1/0 |

- **Mismatches against `docs/security/route-inventory.md`: none.** Every 403 went to a role outside the "Passes the gate" column, or was a qualified grant the service refused with a reason. Examples: "Only the assigned pricer submits to the pricing lead", "Only the quote's KAM can rework it" and "Only the EngLead or the assigned engineer can edit this review".
- Anonymous calls and an unknown persona got **401** on all 123 non-public routes. No route answered a permission check with a 5xx.
- The Leadership dashboard opens for every role with `analytics.read`. That is by design (`dashboards.ts`: `Leadership: 'analytics.read'`).

**Combination checks** (`combos.mjs`, `sec.mjs`). All results were as expected:

- Owner- and region-scoped KAMs on another KAM's quote: GET, timeline, attachments, comment, terms, hand-off, G1/G5 decision, download and delete all returned 404. Their pipeline holds only their own quotes (56 of 56), the CSV export holds only those rows, and the opportunity search and the opportunity detail by id do not show another KAM's opportunity.
- `engineer-owner` on a quote assigned to another engineer: 404. The assigned engineer may edit the review but cannot assign.
- Wrong-stage decisions (G4 at Quoting or Intake, G2 at Intake, G3 at Engineering, G1 at Final Review, G5 and G6 at Final Review): 422.
- Approver: may change the capital terms only in Final Review (403 at Quoting). Customer-funded sign-offs: the Approver gets 403; the sales leader and Leadership get 422 while the switch is off.
- Admin and Leadership cannot decide G1 or G4. Finance cannot decide G3 or upload outside the ROI route.
- Segregation: `multi-role` (SalesLeader + Approver) is refused G4 on its own quote: "You cannot decide Final Review on a quote wh…".

**Row-level security** (raw SQL, read only; changes inside rolled-back transactions):

- As `ccq_app` with an owner-scoped KAM context: 51 quotes visible, 0 owned by someone else. 0 notifications or comments from other people's quotes. 0 audit rows about other people's quotes or actions.
- Region `West` context: 0 rows outside West. With no context: 0 quotes and 0 audit rows.
- `audit_event` as `ccq_app`: UPDATE, DELETE and TRUNCATE are each refused with "permission denied". As the owner (superuser): "audit_event is append-only (UPDATE/DELETE/TRUNCATE rejected)". The row count was unchanged.
- Step 28a: `terms_exception_request` and `g4_signoff` both read `t | t`.

**Commercial figures:** `GET /quotes/:qn` for KAM and Engineer includes `quoting.pricingRecord`, `capitalReadiness`, `prelimCapitalUsd` and the capacity utilization, with `commercialRedacted: false`. The CSV export with `prelimCapitalUsd,capitalReadiness` returns both columns for KAM and Pricing. No role can write a field it then cannot read back: every write I tried was by a role that reads the quote.

## Journeys

Driven through the API with the persona header at each step, except where it says UI. "Pass" means the server behaved as described and the data, audit and notifications checked out.

| ID | Result | Where it failed / note |
|---|---|---|
| J1 | **Pass (API)** | `CCQ-2026-00152`: intake → G1 advance → assign → engineer accepts → review, capacity, BOM → lead capacity sign-off → submit to lead → G2 "capital required" (needs a note) → pricer assigned → cost model → Finance ROI → price record + capital readiness → submit → G3 → KAM terms check → approver confirms capital terms → G4 → G5 Awarded (LOI) → hand-off → G6 → **AWARDED / closed**. 26 audit rows, each with the right actor and role. 36 notifications, the actor never told. The UI was not clicked through. |
| J2 | **Pass (API)** | G2 Rework without a reason → 422. With a reason → back to Intake (rework). Another KAM cannot open the rework (404). The KAM edits and resubmits → back in the G1 queue. The sales leaders are told it was resubmitted. |
| J3 | **Pass (API)** | G3 "Rework (back to KAM)" without a reason → 422; with one → rework. On resubmit: `resumedAt: QUOTING`, `scopeChanged: false`, the quote is back in Quoting and the pricing steps reopen (lead review `none`). |
| J4 | **Pass with defect** | Hold without a date or owner → 422. **A review date in the past is accepted** (DR-04). The hold owner is told ("you own the hold"), and so is the KAM. Resume (G1 advance) works. |
| J5 | **Pass (API)** | KAM: 403 "You may not request a priority tier override". Sales leader: HIGH → CRITICAL, applied at once, `tierOverridden: true`. |
| J6 | **Pass (API)** | Lost with each of the 7 reason codes (no reason → 422), and Expired with both codes (a wrong code → 422) on seeded Customer Decision quotes, decided by the sales leader. The sales leader named another closure owner; it was stored. Only the KAM is told the quote closed, per architecture §FB-05. The new closure owner is not told (see E). |
| J7 | **Pass (API), wording defect in UI** | Net 45 opens an exception, and G4 is blocked while it waits and after a rejection. A rejection without a rationale → 422. After a rejection the pricing lead cannot approve directly (409 "no pending exception"); the KAM must request again. Pricing lead approves → approver re-confirms the capital terms → G4 released. On the Final Review screen (Nov 11) the exception reads clearly ("Payment-terms exception (must be approved to release)", "Net 45", "Waiting for the pricing lead"). The decision dialog shows the raw rule text, though (DR-07). |
| J8 | **Pass (API)** | Admin switched `g4_additional_approvals` **on**. G4 refused: "Final Review also needs: Sales leader, then Leadership". Leadership signing first → 422. Approver signing → 403. Then sales leader → Leadership → a duplicate → 409 → G4 released. The switch is **off again** (I checked the PATCH result). |
| J9 | **Partial / Fail** | With plant `AURORA`, machine `EBM` and market `FOOD` retired: an old quote still opens, and writing the retired plant or machine is refused ("is not an active plant code"). **A new intake with the retired market submits**, and so do made-up codes (DR-02). UI (Nov 11), with the three values retired again: the KAM's quote page shows "Market: Food (no longer offered)", and the approver's Final Review shows "Food", "EBM" and "Aurora (no longer offered)". On the eng lead's Engineering tab, "From the intake" shows "Food (no longer offered)", but the Solution section shows Plant "Aurora" and Machine "EBM" **without** the label (DR-12, `j9-eng-lead.png`). All three values were reactivated. |
| J10 | **Pass (API)** | The engineer and the lead save different fields one after the other: both kept. A parallel save of the same field: last writer wins, no error. Two tabs on one draft: both PATCHes merged the keys (`colorDescription` from tab 1 and `packagingNotes` from tab 2 both kept). There is no version check, so a same-field clash is silent (see E). |
| J11 | **Fail** | DR-01: two concurrent G4 approvals (two approvers, or one approver in two tabs) both return 201. Two decisions, two stage-history rows, 4 instead of 2 "approved" notifications. Confirmed twice from a clean state. In the UI (Nov 11), a double-click and two fast clicks on "Record decision" each sent **one** request (G1 and G4), so one person clicking twice in the dialog is protected. |

## A. Coverage

### `security-access.md`

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | no group | Not tested | Entra sign-in only. Locally: no header → 401 `missing_token`; unknown persona → 401 `unknown_persona`. |
| 2 | each | Not tested | The role chip in the user menu was not checked. The dev persona selector shows the role. |
| 3 | — | Pass (guard) | The switcher is present locally, as expected for `AUTH_MODE=dev`. The API refuses to boot with `NODE_ENV=production AUTH_MODE=dev` ("AUTH_MODE=dev is forbidden when NODE_ENV=production"). The test URL itself was not tested. |
| 4 | — | Not tested | Sign-out is Entra only. |
| 5 | 9 roles | Pass | All 9 match. Approver, Leadership and Admin were swept on Nov 11. |
| 6 | 9 roles | Pass | Sales leader: "To qualify". Eng lead: "Override requests" only. Approver, Leadership, Admin: "Final Review". KAM, engineer, pricing, pricing lead: denied. |
| 7 | 9 roles | Pass | |
| 8 | 9 roles | Pass | |
| 9 | 9 roles | Script corrected | Every role that reads the quote opens `/review` **read-only**, with "You are reading this review. Final Review decisions are taken by an approver." (`kam-review.png`). The route needs only `quote.read`. See C. The Approver gets the decision buttons (Stop, Hold, Rework, "Advance (release the offer)"), checked on Nov 11. |
| 10 | 9 roles | Pass | Engineer denied; the others allowed. |
| 11 | 9 roles | Pass | |
| 12 | 9 roles | Pass | |
| 13 | 9 roles | Pass | Leadership and Admin open "App settings". Leadership's read-only state was not checked control by control. |
| 14 | 9 roles | Pass | Finance also opens it. |
| 15 | KAM | Pass | Pricing record, capital readiness, budgetary capital and capacity are in the response. |
| 16 | Engineer | Pass | The same, on an assigned and on an unassigned quote. |
| 17 | KAM | Pass | Pricing record and capital readiness → 403 `problem+json`. |
| 18 | Engineer | Pass | 403 on a quote assigned to someone else. |
| 19 | Pricing, EngLead | Pass | 409, type `https://quoteflow.pretiumpkg.com/problems/section-locked`. KAM → 403. |
| 20 | KAM | Pass | 403. |
| 21 | Approver + KAM | Pass | Segregation refusal; the quote stays in Final Review. |
| 21a | Finance | Pass | Writes are 403; `/queue/pricing` → 403. The quote opens read-only. The menu shows Home and Pipeline only. "Upload the ROI model" was not seen, because that quote's ROI was already uploaded. |
| 22 | Engineer | Pass | The route answers (404 for an ERF the synthetic history does not hold, not 403). |
| 22a | KAM, Pricing, Approver | Pass | 403, 403, 403 (at Quoting) and 200 (in Final Review). |
| 22b | 5 roles | Pass | 403 ×2; 404 for the unassigned engineer-owner; 200 ×2. `PUT /terms` with `termsMoq` → 400. |
| 22c | 5 roles | Pass | 403 ×4; 200 for the pricing lead. Audit: `update terms_exception_request {"status":"approved","rationale":"test"}`. |
| 22d | 5 roles | Pass | 403 ×3, 422 ×2. |
| 22e | 3 roles | Pass | 409 `SECTION_LOCKED` ×3 on a quote released at G4. |
| 23 | Admin | Pass (API) | Scope set to Own quotes only (200), and the change is in the decision log. Done through the API, not the screen. |
| 24 | KAM A | Pass | 404 "No quote …". |
| 25 | KAM A | Pass | The search returns 0. The pipeline holds only their own quotes (56 = 56 in the DB). |
| 26 | KAM A | Pass | Neither the list nor the detail by id shows KAM B's opportunity (404). |
| 27 | KAM A | Pass | 56 rows, all with this KAM. |
| 28 | Admin | Pass (API) | Reset worked. I then restored the persona's seeded `owner` scope. |
| 28a | DB owner | Pass | `t t` for both tables. |
| 29 | KAM | Pass (API) | Both columns are in the CSV. |
| 30 | KAM | Pass | Columns present; the export still follows the scope (step 27). |
| 31 | Pricing | Pass | |
| 32 | Admin | Pass | `export quote {"rows":…, "columns":["prelimCapitalUsd","capitalReadiness"]}` with who and when. |
| 33 | Admin | Fail (DR-09) | `/admin/audit` lists sign-ins (a daily `sign_in` per persona in dev mode), views, exports, uploads, the scope change and config changes. **Refused calls (403) write no audit row** (checked Nov 11). |
| 34 | Admin | Pass | View event: actor, Central time, quote, action. |
| 35 | DB | Pass | See Row-level security. |
| 36 | Admin | Pass | The audit CSV export writes an `export` audit row. |
| 37 | — | Pass | 213 emails: no `$` amount, no comment text, no XSS payload. Each links to `http://localhost:5205/quotes/<n>`; I checked the link target, but did not click through from the mail. |
| 38 | KAM | Pass | `.exe`, `.html`, `.svg`, `.csv`, `.txt`, `.xlsm`, a double extension and no extension → 422 with the allowed list. An exe or HTML renamed `.pdf` → 422 "The file's content is not a PDF". 101 MB → 413 "The file is 101.0 MB; the limit is 100 MB". |
| 39 | KAM, Pricing, Admin | Pass | Another non-Admin: 403 "Only the person who uploaded it, or an Admin, can remove it". The uploader: 204. Admin: 204. The 24 h expiry was not waited for. |

### `tie-out.md` (only what the fake Salesforce reader and the local DB allow)

| Step | Result | Note |
|---|---|---|
| 1–20 (Part A, B table) | Not tested | Needs real opportunities in Salesforce and Zac's Salesforce view. |
| 21 | Pass (local) | Admin → Integrations: Salesforce `fake`, last run `succeeded`, 0 failures in 24 h. Every delta run reports `fetched: 0` against the fake reader. |
| 22 | Not tested | Salesforce field history. |
| 23 | Pass (local) | `/admin/reports/erf-linkage` returns rows with `linkage` (e.g. `ccq_only`) and `mismatch`. |
| 24–27 | Not tested | Against the real pricing app or export. The synthetic history loads. |
| 28, 31–38 | Not tested | Fabric. |
| 29 | Partial | CCQ-side counts read with SQL for every table in the list (e.g. `quote` 180, `audit_event` 1461). The Fabric side was not tested. |
| 30 | Partial | `audit_event` = `audit_event_fabric` = 1461 on the CCQ side. Fabric was not tested. |

### Cross-cutting items from `05-cross-cutting-and-journeys.md`

| Item | Result | Note |
|---|---|---|
| Stored XSS | Pass | `<img src=x onerror=alert(1)>` and `"><script>alert(2)</script>` went into intake text, ship-to, engineering notes, a comment, feedback (Report an issue) and an Admin value-list label. They rendered as text on the quote, Engineering, Quoting and Review tabs, the queue, the pipeline, Admin → Feedback, Admin → Audit and Admin → Value lists, as 7 personas. No `alert`, no injected element. Not in any email. The test value was deactivated afterwards. |
| CSV injection | Pass | Capacity evidence CSV: `+cmd`, `\t=1+1`, `@SUM`, `-2+3` are exported as `'+cmd…` and so on. The pipeline export uses the same `csvCell`. Its free text comes from Salesforce, so it was not injectable from the UI. |
| Search and filters | Fail (DR-03) | 870 requests: `'`, `%`, `_`, `\`, 5,000 characters, unicode and `{{7*7}}` on 30 search and filter parameters. No unexpected rows (`%` and `_` match nothing; `'` matches O'Conner names). **`%00` → 500** on 6 of them. A 5,000-character path segment → 414 with a framework body (see E). |
| Uploads | Pass with defect (DR-05) | See step 38. Downloads are `attachment; filename=…`, `nosniff`, with a CSP and the right MIME type. A `../../../etc/passwd.pdf` name is stored as `_.._.._etc_passwd.pdf`. The same file twice is stored as `spec (1).pdf`. **A zero-byte file gets a misleading message.** |
| IDs in URLs | Pass | Another user's draft (as admin, sales leader or another KAM), their notification, someone else's attachment, an unknown quote, a lower-case quote number and an injected quote number: 404 or 400, never someone else's data. |
| Mass assignment | Pass | `role`, `status`, `ownerId`, `approvedBy`, `decidedBy`, `actorId` and others: dropped on draft create, G1 and comment (the stored actor and owner are the caller), or refused 400 by the strict schemas (engineering review, pricing record, capital flag, preferences). `approvedBy` set to a KAM's id → 422. |
| Audit and timeline | Pass with notes | J1's 26 audit rows have the right actor. Gate decisions are recorded as `stage_change` with `gateKey` in `after`; the `gate_decision` action value is never used (see E). Duplicates only came from DR-01. |
| Notifications | Pass with notes | The actor is never told. Hand-off, return, hold (KAM + hold owner), closure (KAM) and comment (people declared on the quote): email and in-app, links work, no comment text. Duplicates only from DR-01, and from a second hold on an already-held quote (DR-04). |
| Accessibility | Partial | axe ran on 38 routes × 10 roles at 1280 px and again at 390 px. Desktop: 1 serious issue (DR-06). Mobile: the same, plus `scrollable-region-focusable` on `/admin/reports/usage` (DR-11). Keyboard: the focus order on `/intake/new` is logical (skip link, nav, search, bell, menu, drafts, then the opportunity search) and focus is visible on all 22 stops. The full J1 by keyboard was not done. |
| Mobile 390 px | Pass with defect (DR-10) | 223 open pages (10 roles, touch emulation, 390×844): **no horizontal scroll** anywhere, no page errors, no rate-limit hits. Tap targets: several common controls are under 44 px (DR-10). The DEV persona selector and the skip link are also small, but they are dev-only or keyboard-only. |
| Performance | Pass | With about 180 quotes the API medians are 10–120 ms (slowest: the pipeline list 120 ms, the board 107 ms, the review summary 98 ms). Full page loads took 1.3–2.9 s in Chrome with four other sessions sharing the machine (slowest: eng-lead home 2.9 s, an engineering tab 2.8 s, a closed quote 2.7 s). k6 is not installed. |
| Errors | Pass with notes | Unknown route → 404 problem+json. Validation errors → 400 with paths. Bad JSON → 400. A form post → 415. A 5 MB body → 413. No stack trace or database text in any response. The 500s carry only `title` and `traceId`. The 404 page and "You don't have access to this" render. A rate-limit burst gets 429 problem+json after 300 requests, with `retry-after`. |
| Time | Pass | The timeline shows 2026-08-07 02:00 UTC as "Aug 6, 2026, 9:00 PM" (CDT, the date flips correctly), and a 2026-11-10 22:00 UTC event as 4:00 PM (CST after the Nov 1 change). No seeded event falls in the Nov 1 01:00–02:00 repeated hour. |
| Browser | Chrome only | The bundled Firefox and WebKit are not installed. |
| Session and navigation | Pass | Back, Forward and reload on pipeline → quote: no page errors. A quote link opened by an owner-scoped KAM without access shows "Not found". Intake wizard (Nov 11, `kam-region`): opening a draft puts `?draft=<id>` in the URL; Back, Forward and reload all return to the same draft with no page errors. |

## B. Defects

| ID | Severity | Where (route, role) | Steps | Expected | Actual | Evidence | Suspected cause |
|---|---|---|---|---|---|---|---|
| DR-cross-cutting-01 | **Sev-2** | `POST /quotes/:qn/gates/:gate/decisions` (G4, G5; G1 differs), Approver / KAM | 1. Take a quote to Final Review, terms checked and capital confirmed. 2. Send two `{"outcomeKey":"approve"}` G4 requests at once (two approvers, or the same approver twice, as a double-click would). 3. Read `gate_decision`, `stage_history` and `notification`. | Exactly one decision. The second request gets a 409 or 422, with no change. | Both return **201**. 2 G4 decisions, 2 open `CUSTOMER_DECISION` stage-history rows, 4 "approved" in-app notices and 2 emails each to the KAM and the pricer. With 3 approves and 1 decline at once, all 4 were recorded and the quote ended **DECLINED/closed** after being approved. G5: two Awarded both recorded. Awarded racing Lost → one 201 and one bare **500**. G1 races → 500, 500, 201. Repeated twice from a clean state. The UI stops one person's double-click (one request sent, G1 and G4 dialogs, Nov 11). It cannot stop two users or two tabs. | `j1011.mjs`, `j11r.mjs`, `j11g5.mjs` output; `uidbl.mjs`, `g4ui.mjs` | `apps/api/src/services/gateService.ts` `decide()` (line 129) reads the quote's stage and then writes. There is no row lock (`FOR UPDATE`) and no version check. |
| DR-cross-cutting-02 | **Sev-2** | `POST /quotes/drafts` + `/submit`, KAM | 1. Admin retires market `FOOD`. 2. A KAM submits an intake with `market: "FOOD"` → accepted. 3. Submit intakes with `market: "ZZZ_NOT_A_MARKET"`, `resin: "UNOBTAINIUM"`, `productFamily: "SPACESHIP"`, `neckDiameter: "9999"`, `pcrLevel: "77"`, `packagingType: "LASER"`. | Refused like the engineering fields ("… is not an active plant code"). J9: "a new write is refused". | All submitted (CCQ-2026-00167 to 00173, now stopped). Only `subMarket` and `requestClass` are checked. The UI offers only list values, so pilot users will not hit it, but the server is not the control here (CLAUDE.md rule 1 spirit, rule 4 config lists). | `j9c.mjs`, `lists.mjs` | Intake validation in `apps/api/src/services/intake.ts` and its domain rules does not check `value_list` codes. |
| DR-cross-cutting-03 | Sev-3 | Many routes, any role | 1. `GET /api/v1/quotes?q=%00`. 2. `POST /quotes/drafts` with `"x\u0000y"` in a text field. 3. Feedback or `PUT /eng-review` with `\u0000`. | 400 problem+json "contains an invalid character". | **500** "Internal Server Error" (no detail) for `q` on `/quotes`, `/quotes/board` and `/quotes/export.csv`, `stage` on `/quotes`, `q` on `/users`, `region` on `/analytics/pipeline`, and for drafts, feedback and the engineering review. A comment with a NUL byte returns 201. A NUL can come from pasted PDF or Excel text. | `search.mjs`, `nul.mjs` | Postgres rejects `\0` in `text`. The zod schemas do not strip or refuse it. |
| DR-cross-cutting-04 | Sev-3 | G1/G2… Hold, sales leader | 1. G1 `hold` with `holdUntil` three days in the past, a reason, a note and an owner. 2. Hold the already-held quote again. | A review date in the past is refused. A second hold is refused, or updates the hold. | Both 201. The quote sits on hold with a review date already passed, and the email says "Review date: 2026-11-07". The second hold sends the KAM another notice ("CCQ-…: Hold") on top of "was put on hold". | `j2345.mjs`, notifications for CCQ-2026-00160 | The hold validation (`holdUntil` is checked only for format, `z.iso.date()`). |
| DR-cross-cutting-05 | Sev-3 | `POST /quotes/:qn/attachments`, any uploader | 1. Upload a 0-byte `empty.pdf` (as the browser sends it, size 0). | "The file is empty" or similar. | 422 **"Choose a kind and send the file size first"** (`errors: /size Too small: expected number to be >0`). The user did choose a kind. | `uploads.mjs`, `dl.mjs` | The size `> 0` rule shares the generic "kind and size first" message. |
| DR-cross-cutting-06 | Sev-3 | Quote page Commercial terms, every role (seen on CCQ-2026-00162) | 1. Get a payment-terms exception approved (J7). 2. Open the quote. 3. Run axe. | WCAG AA contrast (4.5:1). | `color-contrast` (serious): the "Approved" pill `[data-testid=terms-exception-status]`, `bg-success text-success-foreground`, has **2.54:1** (#13221f on #1f6b45, 12 px). Seen by all 10 roles swept, at 1280 px and at 390 px. | `axe2.mjs`, `sweep-desktop-*.json` | The `success-foreground` token on `bg-success`. |
| DR-cross-cutting-07 | Sev-3 | G4 decision, Approver | 1. A quote in Final Review with a payment-terms exception waiting. 2. G4 approve. | A plain refusal, e.g. "Waiting for the pricing lead's decision on the payment terms". | 422 `MISSING_FIELD` with `path: "/g4_terms_exception_check_required,terms_exception_open"` and the message "At least one of: g4_terms_exception_check_required must equal false or terms_exception_open must equal false". **Confirmed in the UI (Nov 11):** the approver's "Release proposition" dialog shows it under "Missing before it can move on:", and "Record decision" stays enabled; clicking it gets the 422. The page behind the dialog explains it well ("Payment-terms exception (must be approved to release)", "Waiting for the pricing lead"). Compare the clear J8 message "Final Review also needs: Sales leader, then Leadership". | `j78.mjs`, `g4ui.mjs`, `g4-click-CCQ-2026-00183.png` | The generic required-field rule message in the gate evaluation. |
| DR-cross-cutting-09 | Sev-3 | Audit log, any refused call | 1. Count `audit_event` rows. 2. As the KAM: a G4 decision, a pricing-record save and a scope change on yourself (all 403). 3. Count again. | Security step 33: "Every action from this session is there: … the refused calls …". | No audit row for any of the three 403s. The only new row was that day's `sign_in`. The `audit_event.action` CHECK has no value for a refused call. Either add it, or drop "the refused calls" from step 33; Ben's call. | `audit403.mjs` | `apps/api/src/plugins/audit.ts` audits mutations inside their transaction, so a refused request never reaches it. |
| DR-cross-cutting-10 | Sev-3 | Mobile 390 px, every role | 1. Open the listed pages at 390×844 (touch). 2. Measure the interactive elements. | Tap targets at least 44×44 px (`00-common.md` item 10). | No page scrolls sideways (223 pages). But common controls are smaller: quote-number links in lists are 18–24 px tall (home, `/proposals`, `/quotes`, `/board`, queues, Final Review list); "Why this priority?" 56×32; "Override priority tier" and "Override engineering queue" 97×32; the "About …" info buttons 32×32 (home, analytics); "Table view of …" 75×32; queue filter chips 36 px tall; "Open the Commercial panel" 18–24 px; "Back to notifications" 128×20; checkboxes 13–20 px. | `sweep-mobile-*.json` | Not obvious. |
| DR-cross-cutting-11 | Sev-3 | `/admin/reports/usage` at 390 px, Leadership and Admin | 1. Open the usage report on a phone-width screen. 2. Run axe. | A table that scrolls sideways can be scrolled by keyboard. | axe `scrollable-region-focusable` (serious): `<div class="overflow-x-auto rounded-lg border">` has no focusable content and is not focusable, so keyboard users cannot scroll it. Not flagged at 1280 px, where it does not overflow. | `sweep-mobile-pricing-lead+finance+approver+leadership+admin.json` | The `overflow-x-auto` wrapper has no `tabIndex`. |
| DR-cross-cutting-12 | Sev-3 | Quote → Engineering tab (Solution), eng lead | 1. Admin retires plant `AURORA` and machine type `EBM` (confirm in use). 2. Open an old quote that uses them (CCQ-2026-00176) → Engineering. | "Aurora (no longer offered)" and "EBM (no longer offered)", as Final Review shows. | The Solution card shows "Aurora" and "EBM" with no label. The "From the intake" block above it does label "Food (no longer offered)". An engineer reading the quote cannot tell the plant is retired. | `uimore.mjs`, `j9-eng-lead.png` | Not checked in the code. |
| DR-cross-cutting-08 | Sev-4 | Any route with a long path parameter | 1. `GET /api/v1/quotes/<5,000 characters>`. | 400 or 414 problem+json. | 414 `application/json` `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/v1/quotes/aaaa…"}`: the framework's body, echoing the path. The only non-RFC 9457 error seen. | `search.mjs` | The Fastify default for `maxParamLength`, bypassing the problem handler. |

## C. Script corrections made

| Script | Step | Change | Why |
|---|---|---|---|
| `docs/uat/scripts/security-access.md` | 9 (`/quotes/<CCQ-SEC-FR>/review`) | KAM, sales leader, eng lead, engineer, pricing and pricing lead changed from **Denied** to **Allowed (read-only)**; Leadership and Admin "Allowed (read)" to "Allowed (read-only)". Added a note on what non-approvers see. | The app opens the review read-only for every role that reads the quote. The banner says "You are reading this review. Final Review decisions are taken by an approver." and there are no decide controls. The route needs `quote.read` (route inventory). This follows the 2026-10-30 "no hidden figures" rule. **Ben: please confirm this is intended.** If the screen should be approver-only, revert and treat it as a Sev-3 defect. |

No quick-start says who can open `/review`, so no quick-start changed. **Not changed (other sessions' scope):** `kam.md` step 65 and `pricing.md` step 27 have the same "You don't have access to this" expectation for `/review`. The KAM and pricing sessions own those files.

## D. Could not test, and why

- **Docker Desktop crash (Nov 10, about 17:05 CST), now recovered.** Everything it blocked was run on Nov 11 on the same database: the desktop sweep for Approver, Leadership and Admin, the mobile sweep, the UI double-click checks, the J7 and J9 screens, wizard navigation and the refused-call audit check. Mail sent while Docker was down was not re-checked.
- **Two-tab / two-user race in the UI.** DR-01 was shown through the API. I did not drive two browser sessions to click "Record decision" at the same moment.
- **UI click-through of the journeys.** J1–J11 ran through the API with the persona header to cover every combination in the time available. The UI was checked for rendering, access, XSS, axe, time zone and navigation, not for driving each journey. The full keyboard-only J1 was not done.
- **Entra sign-in, sign-out and the "No QuoteFlow access yet" page** (security steps 1, 2, 4), and a persona with no role: dev mode cannot create one; an unknown persona gets 401.
- **Live Salesforce, the pricing app and Fabric** (tie-out Parts A–D except the CCQ-side counts).
- **Firefox and WebKit**: not installed in Playwright.
- **k6** (`pnpm load:smoke`): not installed.
- **The 24-hour limit on removing your own upload** (step 39): not waited for.
- **Nov 1 repeated hour**: no record falls in 01:00–02:00 Central on Nov 1, and I may not edit the DB to make one.

## E. Observations (not defects, may confuse a pilot user)

- **The brief's persona key is wrong:** `00-common.md` says `localStorage['ccq.devPersona']`. The app reads **`sessionStorage`**. With localStorage the UI silently stays on `kam`.
- **Local setup on Node 24:** the root `pnpm` scripts fail on the engines check even with `npm_config_engine_strict=false`. `apps/web/vite.config.ts` hard-codes port 5173 (`--port … --strictPort` works around it). The `.env.example` comment says "The web dev server (5173) proxies /api to this port".
- **Free opportunities run out:** only about 6 of 102 synthetic opportunities are free after seeding, and a closed quote frees one. Pilot staging on the test site is a different data set, but a long local test session runs dry.
- **The rate limit (300/min per user)** is easy to hit with automation. A human will not hit it.
- The scoring breakdown in the G1 dialog shows "Market: Food — FOOD (not listed, default) → 50 points" and "BOTTLE+HDPE (not listed, default)". The provisional model v2 does not list the new markets yet, so every quote gets the neutral 50 there. This may be expected while v3 is a draft (priority-calibration session's scope).
- On Nov 11 my wizard check opened a rework draft for the seeded CCQ-2026-00149 as `kam-region`, that quote's KAM. It was only opened, not submitted.
- Gate decisions are audited as `stage_change` (with `gateKey`). The `gate_decision` action allowed by the CHECK constraint is never used, so an auditor filtering on "gate decision" finds nothing.
- Refusal details name internal permission keys ("Requires gate.G4.decide on this quote"). That is fine for IT and odd for a pilot user if shown.
- The "moved on" email subject is the same for every stage ("… moved on: Where your quote stands"). Three in a row look like duplicates in an inbox. The stage is only in the body.
- A closure owner named by the sales leader is not told. Only the KAM is, which matches architecture §FB-05.
- J10: there is no version check on engineering-review or draft saves. Different fields merge, but a same-field clash is last-writer-wins with no warning.
- `GET /quotes?limit=abc` and `limit=-5` are ignored silently (200). An unsupported method returns 404, not 405.
- The Salesforce sync against the fake reader always reports `fetched: 0`. Tie-out step 21 expects "a row count", so on the test site, check that a real run shows non-zero counts.
- `label-content-name-mismatch` (serious) was flagged once on `/intake/new` for the KAM while the drafts list held my rework drafts. It did not happen in 3 later runs, so it depends on state and is not reported as a defect.
- An uploaded file's `Content-Disposition` keeps the original name (`filename="../../../etc/passwd.pdf"`) rather than the cleaned stored name. Browsers strip the path, so it is harmless, but it is inconsistent.
