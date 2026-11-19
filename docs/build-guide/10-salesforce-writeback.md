# 10 · Salesforce write-back: what has to happen before it is switched on

**Step:** FB-29 (N19-01, N19-02; D-16w, D-014, F-035). **Status:** built and **switched off** in every environment. **Synthetic data only.**

QuoteFlow can now update a Salesforce opportunity's stage when a customer outcome is recorded, through a queue it controls. Nothing is written until the steps below are done, in order. Turning it on is configuration and a checklist, not a code change, **except** for one thing: a Salesforce field QuoteFlow has never written before (for example a custom "CCQ quote number" field) must first be added to the write allow-list in code (`packages/integrations/src/salesforce/writeMap.ts`), on purpose, so that a typo or a price field can never be configured.

Every statement below is marked **[verified]** (checked in this repository or by a test) or **[unverified]** (an assumption about Salesforce or Pretium's setup that someone must confirm).

## What QuoteFlow writes today, once switched on

| When | Salesforce field | Value | Notes |
|---|---|---|---|
| A customer outcome is recorded at Customer Decision (G5) | `Opportunity.StageName` | The outcome's stage from `sf_outcome_stage_names`: Awarded → "Verbal Award", In negotiation → "Negotiating", Lost and Expired → "Closed Lost" | **[verified]** in code and tests. The stage names are the FB-04 seed, provisional. Lost and Expired **close** the opportunity, so they are skipped while another open quote or an open re-quote draft is on the same opportunity. |
| A linked re-quote starts after QuoteFlow closed the opportunity | `Opportunity.StageName` | The `requote` stage ("Quoting") | **[verified]** Sent only if Salesforce still shows the closed stage QuoteFlow wrote; if a sales person moved it on, it is skipped and logged. |
| Any stage change | `StageName` | through `stageMap` | **Off** **[verified]**: the stage table is empty. |
| The quote number or link | a custom field | the CCQ quote number or its QuoteFlow link | **Off** **[verified]**: no field is named, and none is on the allow-list. |

Never written **[verified]**: any price, cost, margin, revenue or capital field (a test fails on one), any Account (rule 7), any create or delete. QuoteFlow never waits for Salesforce: a failed write never blocks or undoes a decision in QuoteFlow (N19-02).

## Before it can be switched on (in order)

1. **A separate write identity (IT, Rachel).** A second External Client App in Salesforce, with a "Run As" user that has **edit access on `Opportunity.StageName` and on any approved custom field, and nothing else**, and read access to the opportunities QuoteFlow quotes on. Client credentials flow, like the read connection. **Never** the existing read-only integration user, and never the read app's consumer key (QuoteFlow refuses to start if `SF_WRITE_CLIENT_ID` equals `SF_CLIENT_ID` **[verified]**). **[unverified]** that Pretium's licence allows a second integration user.
2. **A Salesforce sandbox for the first live test (IT, Rachel).** Outside production QuoteFlow only writes to a sandbox: the login URL and the instance Salesforce returns must be a My Domain containing `.sandbox.` (for example `https://<my-domain>--<sandbox>.sandbox.my.salesforce.com`); `test.salesforce.com` and `login.salesforce.com` are refused **[verified]**. **[unverified]** that a sandbox exists, and that it holds opportunities with the same ids as the quotes it will be tested with (a fresh sandbox does not; the test can use a sandbox-only quote).
3. **What may be written (Salesforce owner: Zachary Cairns?).** **[unverified]** who signs this off. Confirm:
   - which stage names QuoteFlow may set, for each outcome (`sf_outcome_stage_names`, provisional) and for the reopen;
   - the order of the stages for the "never move backwards" check (`sf_writeback_map.stageRank`, provisional: the closed stages rank last, Closed Won above Closed Lost);
   - any **validation rules, flows or required fields** that fire on a stage change, for example a loss reason required on Closed Lost **[unverified]**. A rule that refuses the update makes the write fail at once (it is not retried) and an Admin is told; QuoteFlow does not send a loss reason today;
   - the API names of any custom fields to write (CCQ quote number, link, QuoteFlow stage). Each must be added to `writeMap.ts` by a developer and to `sf_writeback_map` by an Admin.
4. **Key Vault and app settings (Ben wires them in `infra/`; FB-29 did not edit `infra/`).** Proposed names, **[unverified]** until created:

   | App setting | Value | Secret? |
   |---|---|---|
   | `SF_WRITE_MODE` | `off` (default), then `live` | no |
   | `SF_WRITE_CLIENT_ID` | the write app's consumer key | no |
   | `SF_WRITE_CLIENT_SECRET` | Key Vault reference to `sf-write-client-secret` | **yes** |
   | `SF_WRITE_LOGIN_URL` | the sandbox My Domain URL on test; the production My Domain URL on prod | no |
   | `SF_WRITE_INTERVAL_SECONDS` | `60` (default) | no |

   There is **no default** for `SF_WRITE_LOGIN_URL` **[verified]**: the read connection's default (`test.salesforce.com`) must never pass for a sandbox. `SF_WRITE_MODE=fake` is refused in production, and `live` is refused while `SF_MODE=fake` **[verified]**.
5. **Approve the settings (business owners, in Admin → Settings).** `sf_writeback_map`, `sf_outcome_stage_names`, `sf_writeback_stage_regression` (seed `skip`), `sf_writeback_max_attempts` (seed 5) and `sf_writeback_retry_minutes` (seed 1, 5, 30, 120, 360) are seeded **provisional** **[verified]**.

## Rollout

1. **Dry run in each environment (a few days).** Admin → Integrations → Salesforce write-back: tick "Write back to Salesforce", mode **Dry run**. Every outcome is recorded in the outbox as "Dry run" with the exact payload that would be sent, and nothing is sent **[verified]**. Read the rows with the KAMs: are the stages right? Were the closing writes skipped where another quote was open? Use **Preview** on a few quote numbers. Dry run is allowed even where there is no write connection.
2. **Sandbox.** With the write identity pointing at the sandbox (`SF_WRITE_MODE=live`, `SF_WRITE_LOGIN_URL` = the sandbox) on the **test** site, switch the mode to **Live**. Record outcomes on quotes whose opportunities exist in the sandbox and check them in Salesforce. Try a validation rule failure and a re-quote.
3. **Production.** Only after the owner signs off steps 3 and 5: set the production app settings and switch the mode to **Live** in production.

The test site reads Salesforce **production** (`SF_MODE=live` there) **[verified in `infra/main.test.bicepparam`: `sfMode = 'live'` against the production My Domain; not checked against the deployed site]**. That is why the test site may only write to a sandbox, and why the writer reads the current stage through its own session, never through the reader.

## Switching it off

Untick "Write back to Salesforce" (or set the mode back to **Dry run**). The worker stops sending at its next run (within a minute) **[verified]**: rows still queued stay "Queued" and are sent only if it is switched back on and live; an Admin can **Skip** them. To remove the connection entirely set `SF_WRITE_MODE=off` and restart: the mode can then not be set to Live, in the card or in Admin → Settings **[verified]**. KAMs are again reminded to update Salesforce by hand.

## What the outbox states mean

| State | Meaning | What to do |
|---|---|---|
| Queued | Waiting to be sent (or to be retried: the row shows tries and the next try) | Nothing |
| Sent | Salesforce accepted it, or already held that value (a retry after a timeout that had in fact reached Salesforce; the audit row says `confirmed_existing`) | Nothing |
| Dry run | Recorded in dry-run mode; never sent | Nothing |
| Not written | QuoteFlow decided not to write it, with the reason: a newer value replaced it; Salesforce is at a later stage; another quote still needs the opportunity; QuoteFlow had not closed it (a reopen); moved in Salesforce since (a reopen); skipped by an Admin | Nothing, unless the reason is unexpected |
| Failed | Salesforce refused it (for example a validation rule), or every retry failed. Each Admin got one notification | Read the error. Fix the cause in Salesforce or the mapping, then **Retry**; or **Skip** it and update the opportunity by hand |

Every queue, send, skip, failure, retry and Admin skip writes an audit row (entity `sf_writeback`) with the field, the value and the reason; nothing secret **[verified]**.

## Not built (ask Ben)

- **No back-fill.** Switching the write-back on does not write the outcomes of quotes decided while it was off **[verified]**. Should it?
- Every stage change, or only outcomes, for the first release? (`stage_changed` exists, switched off.)
- QuoteFlow sends no loss reason or competitor. If Salesforce requires one on Closed Lost, the write fails until a field is mapped.
