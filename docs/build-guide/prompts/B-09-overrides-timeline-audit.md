# B-09 · Governed overrides, activity timeline, usage audit log (F-06, F-08, F-12)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` rules 1–4 and `01-architecture.md` §5 (`override`, `activity_event`, `audit_event`). These are cross-cutting controls. Build them once as reusable services and components that every later stage calls.

## 1. Governed override service (`packages/domain/src/overrides/` + `apps/api/src/services/overrideService.ts`)

**Fields** (config list `overridable_fields`):
- `priority_tier`: the approver is SalesLeader or EngLead
- `ship_to`: KAM self-applies with a reason, and the request is visible in the log; the approver is "none (self, logged)"
- `queue_position` (EngLead manual pin to top): EngLead self-applies

The approver per field is **config**, because who approves overrides is a blueprint gap still to be confirmed.

**Lifecycle:** `requested → approved → applied` or `requested → rejected`; `applied → reverted` (one click, by an approver or the requester if self-applied).
- **Justification** is required (minimum 15 characters).
- `original_value` is captured at request time and is never lost.
- The reverted value is restored exactly.
- Concurrency: if the underlying field changed since the request, the approval fails with 409.

**Effects:**
- Updates the quote field and sets the `*_overridden` flag.
- Writes an `activity_event` (visible on the timeline) and an `audit_event` with before and after.
- Notifies the approver and the requester (stub until B-18).

**API:**
- `POST /quotes/:qn/overrides`
- `POST /overrides/:id/approve|reject|revert`
- `GET /quotes/:qn/overrides`
- `GET /overrides?status=requested` (approver inbox)
- `GET /admin/override-log` (Leadership + Admin only: `overrideLog.read`)

**UI:**
- An override affordance (pencil + "Override") beside the tier and ship-to on quote detail.
- A dialog showing current → requested values with justification.
- A pending badge.
- Approver inbox section on Approvals.
- "Revert" in the timeline entry.
- Overridden values show a small copper "Overridden" marker with a tooltip showing the original value and justification.

## 2. Activity timeline (F-08)
- `GET /quotes/:qn/timeline?cursor=` merges, newest first:
  - `activity_event` (stage changes, gate decisions with note/reason, overrides, uploads, comments, assignments, SF flag changes)
  - comments
- Each item shows who, when (relative + absolute in the user's timezone), what and details.
- Comments: `POST /quotes/:qn/comments` with `@mentions` (user picker), mentions notify the user (B-18 hook). Markdown-lite, sanitized.
- `Timeline` component: filter chips (All / Decisions / Overrides / Files / Comments), plus mobile layout.

## 3. Usage audit log (F-12; append-only)
- A Fastify plugin writes `audit_event` for:
  - every **view** of a quote (`GET /quotes/:qn`, debounced to one per user per quote per 10 minutes)
  - every mutation (via services)
  - every **export** (B-14)
  - every upload or download (B-16)
  - sign-in
  - config changes (B-19)
- Captured: actor, roles, action, entity, ids, before/after (redacted of tokens), IP, user agent and request id.
- Writes happen in the same transaction as the mutation. View audits are async, best effort, and never fail the request.
- The DB already denies UPDATE/DELETE for `ccq_app` (B-03). Add a test proving it.
- **Admin audit viewer** at `/admin/audit` (config.manage + Leadership read): filter by user, quote, action and date, and export CSV (that export is audited too).
- This audit log is how adoption is measured (PRD 8.2). Add `GET /admin/reports/usage` with daily active users by role, quotes viewed and actions by type.

## Tests
- Override lifecycle including 409 on a stale value; revert restores the original exactly; justification required; approver per config.
- The timeline includes every event type; mentions create notifications.
- Audit: a view creates one event per 10 min; mutations are transactional (a failed mutation leaves no audit row); UPDATE/DELETE are denied.
- Permission matrix: only Leadership/Admin see the override log.

## Acceptance
- [ ] Tier and ship-to overrides work end to end with approval and revert
- [ ] Quote detail shows the full timeline
- [ ] Audit viewer and usage report work
- [ ] Tick B-09 in `docs/build-guide/03-build-steps.md`, noting who approves overrides as confirmed in R1
