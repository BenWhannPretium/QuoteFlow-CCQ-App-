# UAT script: Security and access (pen test light)

| | |
|---|---|
| Session | **U4**, Wed Nov 11 (60 min). Run by Ben Whann with the IT security delegate. Part of the Gate 5 evidence. |
| Tester roles | IT security delegate (observer and tester), Ben (driver) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | One test account per role, each in exactly one group: `SG-CCQ-KAM`, `SG-CCQ-SalesLeader`, `SG-CCQ-EngLead`, `SG-CCQ-Engineer`, `SG-CCQ-Pricing`, `SG-CCQ-PricingLead`, `SG-CCQ-Approver`, `SG-CCQ-Leadership`, `SG-CCQ-Admin`. Plus one account in **no** `SG-CCQ-*` group. Use a private browser window per account. |
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
| 14 | `/pricing-history` | Denied | Denied | Allowed | Denied | Allowed | Allowed | Allowed | Allowed | Allowed | | |

## Part C: The server enforces it, not the screen

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 15 | As the KAM, open `<CCQ-SEC-QT>` with the Network tab open. Look at the `GET /api/v1/quotes/<number>` response. | The JSON has the approval status (approved, by whom, when) but **no** pricing basis, range, ERF references, capital readiness, preliminary capital or capacity numbers. | | |
| 16 | As the Engineer, do the same. | Same: no commercial figures in the JSON, even on an assigned quote. | | |
| 17 | As the Pricing user, do the same. | The commercial fields are present. | | |
| 18 | As the KAM, copy a G4 call: send `POST /api/v1/quotes/<CCQ-SEC-FR>/gates/G4/decisions` with `{"outcomeKey":"approve"}` (Ben shows how, using the browser's token). | **403**, an RFC 9457 problem+json body. Nothing changes on the quote. | | |
| 19 | As the Approver who is also the KAM on a quote (Ben stages it), send the same call for that quote. | Refused (segregation). The quote stays in Final Review. | | |
| 20 | As the Engineer, `GET /api/v1/pricing-history…` (any history route). | **403**. | | |

## Part D: Data scope across users

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 21 | As Admin: **Admin** → **Users and scope** → KAM test user A → **Scope** → **Own quotes only**. Give a reason in "Why are you making this change?". **Save change**. | Saved. The change is in **Admin** → **Decision log**. | | |
| 22 | As KAM A: type `/quotes/<CCQ-SEC-B>` after the test URL. | The quote does not open ("Not found" or "You don’t have access to this"). | | |
| 23 | As KAM A: search `<CCQ-SEC-B>` in the header search, and look in **Pipeline**. | Not found. Only KAM A's quotes are listed. | | |
| 24 | As KAM A: **New intake** → **All**, search for KAM B's Salesforce opportunity. | It is not listed (Salesforce opportunities follow the same scope). | | |
| 25 | As KAM A: **Export CSV** from **Pipeline**. | Only KAM A's quotes are in the file. | | |
| 26 | As Admin: set KAM A back to the default scope. | KAM A sees the full pipeline again. | | |

## Part E: Export redaction

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 27 | As the KAM: **Pipeline** → **Export CSV**. | No **Prelim capital (USD)** or **Capital readiness** column. | | |
| 28 | As the KAM: request the export URL by hand with `columns=prelimCapitalUsd,capitalReadiness` added. | The server drops the commercial columns (or refuses). They are not in the file. | | |
| 29 | As Pricing: export with those two columns chosen. | Both columns are in the file. | | |

## Part F: Audit log

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 30 | As Admin: **Admin** → **Audit log**. Filter by each test user and today. | Every action from this session is there: sign-ins, quote views, the refused calls, the scope change, each export and any upload. | | |
| 31 | Check one entry for a quote view. | Who, when (US Central day), which quote, which action. | | |
| 32 | Ben runs `UPDATE audit_event SET … WHERE …` and `DELETE FROM audit_event WHERE …` against the test database as the app role and as the owner. | Both refused: "audit_event is append-only". | | |
| 33 | As Admin: **Admin** → **Audit log** → **Export CSV**. | The export itself appears as a new audit entry. | | |

## Part G: Email and uploads

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 34 | Read three QuoteFlow emails (arrival, Final Review, G4 decided). | No price, margin or capital amount, whatever the recipient's role. | | |
| 35 | Upload a file type that is not allowed, and one over the size limit. | Both refused with a reason. | | |
| 36 | As an uploader, remove your own file. As another non-Admin user, try to remove it. | You can remove your own within 24 hours. The other user cannot. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | IT security delegate | | | |
| | Builder (Ben Whann) | | | |
