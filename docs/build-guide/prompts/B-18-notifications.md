# B-18 · Notifications: P0 minimum (in-app + email)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `01-architecture.md` §6 (email row). PRD F-15 (notifications) is P1. However, the 10/14 Requirements Sync made the **alert to the engineering lead** part of P0 (X-91), and assignment, return and approval alerts are needed for the workflow to move without email chasing. Build the minimal P0 set now. The Teams digest and SLA/stale alerts are P1, because their thresholds don't exist yet (D-20).

## Inputs from M7 (Oct 27)
- A shared mailbox `ccq-noreply@pretiumpkg.com` (or whatever IT names it).
- Graph application permission `Mail.Send`, restricted by an **Exchange application access policy** to that mailbox only.

## Build
1. **Notification service** (`apps/api/src/services/notificationService.ts`):
   - The domain `effects.notifications` from B-02, plus explicit calls from B-09 (overrides, mentions) and B-13 (expiry), produce `notification` rows in the same transaction as the triggering change.
   - A dispatcher job (every minute, advisory lock) sends email for rows with `channel='email'`, with retry/backoff (3 tries), stores `sent_at` and `error`, and on final failure raises an **owner-only** alert (Admin in-app + log). Per the PRD, "failure alerts to owners only".
2. **Events (P0):**

| Event | Recipients | In-app | Email |
|---|---|---|---|
| Quote entered engineering queue | All `CCQ.EngLead` (+ backup assigner) | ✔ | ✔ |
| Quote assigned / reassigned | Assigned engineer | ✔ | ✔ |
| Returned to KAM (G1/G2 rework) | KAM | ✔ | ✔ |
| To qualify (G1) | `CCQ.SalesLeader` | ✔ | daily batch at 7:00 CT (one email listing all) |
| Awaiting Final Review (G4) | `CCQ.Approver` | ✔ | ✔ |
| G4 decided | KAM, Pricing approver | ✔ | ✔ |
| Override requested / decided | Approver / requester | ✔ | — |
| @mention in comment | Mentioned user | ✔ | ✔ |
| Proposal validity ≤ 7 days / expired | KAM | ✔ | ✔ (once per state) |
| Integration failure | Admins | ✔ | — |

3. **Email content:**
   - Plain, branded HTML + text alternative, with a subject like `[QuoteFlow] CCQ-2026-00042 needs your review: Engineering queue`.
   - The body has the quote number, account, product one-liner, tier, the action needed and a deep link.
   - **No pricing or capital figures in email, ever**, whatever the recipient's role.
   - Templates live in `apps/api/src/emails/*.tsx` (react-email) or as simple tagged templates.
4. **In-app:**
   - A bell with an unread count (polling every 60 s via TanStack Query; no websockets in MVP).
   - A dropdown list with mark-read / mark-all-read, and a `/notifications` page.
5. **Preferences:** `/me/preferences` lets each user opt out of email per event type (in-app can't be disabled). Store in a `user_preference` table (add a migration).
6. **Local dev:** a mailpit SMTP transport when `MAIL_MODE=smtp`, and Graph when `MAIL_MODE=graph`.

## Tests
- Recipients resolved per event and role; transactional creation (a rolled-back change creates no notification).
- The dispatcher retries and alerts the owner; no commercial fields in any rendered email (a snapshot test that scans for currency patterns).
- Preferences honoured.

## Acceptance
- [ ] Jim (EngLead) gets an email + in-app alert when a quote enters his queue
- [ ] Approvers are alerted for G4; KAMs are alerted on returns and decisions
- [ ] Failures alert owners only
- [ ] Tick B-18 in `docs/build-guide/03-build-steps.md`
