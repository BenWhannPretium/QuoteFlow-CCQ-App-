# UAT script: Security and access (pen test light)

| | |
|---|---|
| Session | **U4**, Wed Nov 11 (60 min). Run by Ben Whann with the IT security delegate. Part of the Gate 5 evidence. |
| Tester roles | IT security delegate (observer and tester), Ben (driver) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | One test account per role, each in exactly one group: `SG-CCQ-KAM`, `SG-CCQ-SalesLeader`, `SG-CCQ-EngLead`, `SG-CCQ-Engineer`, `SG-CCQ-Pricing`, `SG-CCQ-PricingLead`, `SG-CCQ-Finance` (FB-07, once IT has created it, A-032), `SG-CCQ-Approver`, `SG-CCQ-Leadership`, `SG-CCQ-Admin`. Plus one account in **no** `SG-CCQ-*` group. Use a private browser window per account. |
| Before you start | Ben lists the test accounts: `<TEST-USER per role, from IT>`. Quotes from U1–U3 exist. Browser developer tools are allowed (Network tab). |
| How to log a problem | Use **Report an issue**. Every access failure is **Sev-2** or higher. |

**Data**

| Placeholder | What it is |
|---|---|
| `<CCQ-SEC-A>` | A quote owned by KAM test user A |
| `<CCQ-SEC-B>` | A quote owned by a different KAM, in a region KAM A does not cover |
| `<CCQ-SEC-FR>` | A quote in Final Review |
| `<CCQ-SEC-QT>` | A quote in Quoting with a price approval and capital readiness |

## Part A: Sign-in

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in with the account in no `SG-CCQ-*` group. | Refused at Microsoft sign-in, or "No QuoteFlow access yet" ("…ask IT to add you to an SG-CCQ group"). No data shows. | | |
| 2 | Sign in with each role account. Open the user menu. | The role chip matches the group (for example `KAM`, `PricingLead`). | | |
| 3 | Look for a role or persona switcher on the test URL. | None. Dev sign-in mode is off outside a laptop. | | |
| 4 | Sign out from the user menu. Press the browser Back button. | The sign-in page shows. No quote data is shown from cache. | | |

## Part B: Role matrix spot checks (navigation and direct URLs)

Type each address after the test URL. "Allowed" means the page opens. "Denied" means "You don’t have access to this".

| # | Address | KAM | Sales leader | Eng lead | Engineer | Pricing | Pricing lead | Approver | Leadership | Admin | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | `/intake/new` | Allowed | Allowed | Denied | Denied | Denied | Denied | Denied | Denied | Allowed | | |
| 6 | `/approvals?gate=G1` (the **To qualify** tab) | Denied | Allowed (To qualify, Overrides) | Overrides tab only | Denied | Denied | Denied | Final Review tab only | Final Review tab only | Final Review and Overrides tabs, no To qualify | | |
| 7 | `/queue/engineering` | Denied | Denied | Allowed | Allowed (My assignments) | Denied | Denied | Denied | Allowed (read-only) | Allowed | | |
| 8 | `/queue/pricing` | Denied | Denied | Denied | Denied | Allowed | Allowed (with assign) | Denied | Allowed (read-only) | Allowed | | |
| 9 | `/quotes/<CCQ-SEC-FR>/review` | Denied | Denied | Denied | Denied | Denied | Denied | Allowed (decide) | Allowed (read) | Allowed (read) | | |
| 10 | `/analytics` | Denied | Allowed | Allowed | Denied | Allowed | Allowed | Allowed | Allowed | Allowed | | |
| 11 | `/admin/override-log` | Denied | Denied | Denied | Denied | Denied | Denied | Denied | Allowed | Allowed | | |
| 12 | `/admin/audit` | Denied | Denied | Denied | Denied | Denied | Denied | Denied | Allowed | Allowed | | |
| 13 | `/admin/settings` | Denied | Denied | Denied | Denied | Denied | Denied | Denied | Allowed (read-only) | Allowed (edit) | | |
| 14 | `/pricing-history` | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | | |

## Part C: The server enforces it, not the screen

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 15 | As the KAM, open `<CCQ-SEC-QT>` with the Network tab open. Look at the `GET /api/v1/quotes/<number>` response. | The JSON has the pricing record, capital readiness, budgetary capital and capacity numbers. Every role that can read a quote sees them (decision of 2026-10-30), so nothing is stripped. | | |
| 16 | As the Engineer, do the same. | Same: the commercial figures are present, on an assigned quote and on one that is not. | | |
| 17 | As the KAM, send the request that **Save price approval** sends (Ben shows how, using the browser's token) for `<CCQ-SEC-QT>`. Then the same for **Save capital readiness**. | **403**, problem+json. Seeing a figure is not permission to change it. Nothing changes on the quote. | | |
| 18 | As the Engineer, send a save for the engineering solution on a quote assigned to someone else. | **403**. Only the assigned engineer and the lead write it. | | |
| 19 | On a quote whose G2, G3 or G4 is decided, as the role that owns the section (for example Pricing on `<CCQ-SEC-FR>`), send the save request for that section. | **409** problem+json of type `…/problems/section-locked`. Nothing changes. A role without permission still gets 403. | | |
| 20 | As the KAM, copy a G4 call: send `POST /api/v1/quotes/<CCQ-SEC-FR>/gates/G4/decisions` with `{"outcomeKey":"approve"}` (Ben shows how, using the browser's token). | **403**, an RFC 9457 problem+json body. Nothing changes on the quote. | | |
| 21 | As the Approver who is also the KAM on a quote (Ben stages it), send the same call for that quote. | Refused (segregation). The quote stays in Final Review. | | |
| 21a | FB-07 (F-083). As the Finance account, open `<CCQ-SEC-QT>`, then try **Save price approval**, a file upload on **Attachments**, `/queue/pricing` and a G3 decision (Ben shows how). | The quote and its Quoting tab open read-only, with **Upload the ROI model** only when the quote needs an ROI. Every other write is **403**; `/queue/pricing` is denied. The menu shows **Home** and **Pipeline** only. | | |
| 22 | As the Engineer, `GET /api/v1/pricing/erf/<a known ERF number>`. | **200**. The pricing history is open to every role that reads a quote. | | |

## Part D: Data scope across users

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 23 | As Admin: **Admin** → **Users and scope** → KAM test user A → **Scope** → **Own quotes only**. Give a reason in "Why are you making this change?". **Save change**. | Saved. The change is in **Admin** → **Decision log**. | | |
| 24 | As KAM A: type `/quotes/<CCQ-SEC-B>` after the test URL. | The quote does not open ("Not found" or "You don’t have access to this"). | | |
| 25 | As KAM A: search `<CCQ-SEC-B>` in the header search, and look in **Pipeline**. | Not found. Only KAM A's quotes are listed. | | |
| 26 | As KAM A: **New intake** → **All**, search for KAM B's Salesforce opportunity. | It is not listed (Salesforce opportunities follow the same scope). | | |
| 27 | As KAM A: **Export CSV** from **Pipeline**. | Only KAM A's quotes are in the file. | | |
| 28 | As Admin: set KAM A back to the default scope. | KAM A sees the full pipeline again. | | |

## Part E: Exports

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 29 | As the KAM: **Pipeline** → **Columns**, choose the budgetary capital estimate and capital readiness, then **Export CSV**. | Both columns are in the file. Exports are audited. | | |
| 30 | As the KAM: request the export URL by hand with `columns=prelimCapitalUsd,capitalReadiness` added. | The columns are in the file (no redaction for any role). The export still respects your **data scope** (Part D). | | |
| 31 | As Pricing: export with those two columns chosen. | Same result. | | |
| 32 | In **Admin → Audit**, find the three exports. | Each is an `export` event with who, when and the columns. | | |

## Part F: Audit log

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 33 | As Admin: **Admin** → **Audit log**. Filter by each test user and today. | Every action from this session is there: sign-ins, quote views, the refused calls, the scope change, each export and any upload. | | |
| 34 | Check one entry for a quote view. | Who, when (US Central day), which quote, which action. | | |
| 35 | Ben runs `UPDATE audit_event SET … WHERE …` and `DELETE FROM audit_event WHERE …` against the test database as the app role and as the owner. | Both refused: "audit_event is append-only". | | |
| 36 | As Admin: **Admin** → **Audit log** → **Export CSV**. | The export itself appears as a new audit entry. | | |

## Part G: Email and uploads

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 37 | Read three QuoteFlow emails (arrival, Final Review, G4 decided). | No price, margin or capital amount, whatever the recipient's role. | | |
| 38 | Upload a file type that is not allowed, and one over the size limit. | Both refused with a reason. | | |
| 39 | As an uploader, remove your own file. As another non-Admin user, try to remove it. | You can remove your own within 24 hours. The other user cannot. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | IT security delegate | | | |
| | Builder (Ben Whann) | | | |
