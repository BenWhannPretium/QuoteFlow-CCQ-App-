# API route inventory

> Generated from `apps/api/test/permissions/registry.ts` and `packages/domain/src/policy/matrix.ts`.
> **Do not edit by hand.** Regenerate with `UPDATE_ROUTE_INVENTORY=1 pnpm --filter @ccq/api test routeMatrix`.
> `routeMatrix.test.ts` fails if this file is stale, and `test/permissions/matrix.int.test.ts` sends
> every route below as every role (allowed: not 401/403; denied: 403 problem+json) and anonymously (401).

119 routes: 3 public, 6 for any signed-in role, 110 gated by a matrix permission.

Qualified grants (own, assigned, fields, stages) pass the route gate; the service then checks the
quote with `assertCan`, and Postgres RLS enforces the data scope as the second layer.

| Method | Route | Permission | Passes the gate | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/audit` | `audit.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/audit/export.csv` | `audit.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/config/decision-log` | `config.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/config/decision-log/export.csv` | `config.read` | Leadership, Admin |  |
| PATCH | `/api/v1/admin/config/gates/:gateKey/outcomes/:key` | `config.manage` | Admin |  |
| PATCH | `/api/v1/admin/config/gates/:key` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/config/reason-codes` | `config.read` | Leadership, Admin |  |
| POST | `/api/v1/admin/config/reason-codes` | `config.manage` | Admin |  |
| PUT | `/api/v1/admin/config/reason-codes/:context/order` | `config.manage` | Admin |  |
| PATCH | `/api/v1/admin/config/reason-codes/:id` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/config/scoring` | `config.read` | Leadership, Admin |  |
| POST | `/api/v1/admin/config/scoring/draft` | `config.manage` | Admin |  |
| PUT | `/api/v1/admin/config/scoring/draft` | `config.manage` | Admin |  |
| POST | `/api/v1/admin/config/scoring/draft/activate` | `config.manage` | Admin |  |
| POST | `/api/v1/admin/config/scoring/draft/discard` | `config.manage` | Admin |  |
| POST | `/api/v1/admin/config/scoring/preview` | `config.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/config/settings` | `config.read` | Leadership, Admin |  |
| PATCH | `/api/v1/admin/config/settings/:key` | `config.manage` | Admin |  |
| PATCH | `/api/v1/admin/config/stages/:key` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/config/value-lists` | `config.read` | Leadership, Admin |  |
| POST | `/api/v1/admin/config/value-lists` | `config.manage` | Admin |  |
| PATCH | `/api/v1/admin/config/value-lists/:id` | `config.manage` | Admin |  |
| PUT | `/api/v1/admin/config/value-lists/:listKey/order` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/config/workflow` | `config.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/feedback` | `feedback.triage` | Admin |  |
| PATCH | `/api/v1/admin/feedback/:id` | `feedback.triage` | Admin |  |
| GET | `/api/v1/admin/feedback/:id/screenshot` | `feedback.triage` | Admin |  |
| GET | `/api/v1/admin/integrations` | `config.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/integrations/health` | `config.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/override-log` | `overrideLog.read` | Leadership, Admin |  |
| GET | `/api/v1/admin/pricing-history` | `config.manage` | Admin |  |
| POST | `/api/v1/admin/pricing-history/import` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/reports/erf-linkage` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/reports/outcomes` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/admin/reports/usage` | `audit.read` | Leadership, Admin |  |
| POST | `/api/v1/admin/salesforce/sync` | `config.manage` | Admin |  |
| GET | `/api/v1/admin/users` | `config.read` | Leadership, Admin |  |
| PUT | `/api/v1/admin/users/:id/scope` | `config.manage` | Admin |  |
| GET | `/api/v1/analytics/adoption` | `audit.read` | Leadership, Admin |  |
| GET | `/api/v1/analytics/cycle-time` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/engineering` | `engQueue.read` | EngLead, Engineer, Leadership, Admin |  |
| GET | `/api/v1/analytics/filters` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/first-pass` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/flow` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/g1-yield` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/gate-compliance` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/outcomes` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/overrides` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/pipeline` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/analytics/priority` | `analytics.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/approvals` | `finalReview.read` | Approver, Leadership, Admin |  |
| DELETE | `/api/v1/attachments/:id` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/attachments/:id/download` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/auth/config` | `public` | anyone (no sign-in) | MSAL bootstrap (tenant, client id, auth mode): the SPA needs it before anyone can sign in |
| GET | `/api/v1/config/public` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/dashboards/:role` | `quote.read` | SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin | also requires `analytics.read` |
| POST | `/api/v1/feedback` | `feedback.submit` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/files/local` | `public` | anyone (no sign-in) | FILESTORE_MODE=local only (dev/CI; not registered with SharePoint): the signed, short-lived token is the credential, standing in for a SharePoint pre-authenticated link |
| GET | `/api/v1/gates/:gateKey/queue` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/health` | `public` | anyone (no sign-in) | Liveness/readiness probe for App Service and the availability alert: no data, no identity |
| GET | `/api/v1/me` | `authenticated` | any signed-in CCQ role | The caller's own profile, roles and permissions |
| GET | `/api/v1/me/preferences` | `authenticated` | any signed-in CCQ role | The caller's own email preferences |
| PUT | `/api/v1/me/preferences` | `authenticated` | any signed-in CCQ role | Updates the caller's own email preferences |
| GET | `/api/v1/notifications` | `authenticated` | any signed-in CCQ role | The caller's own notifications |
| POST | `/api/v1/notifications/:id/read` | `authenticated` | any signed-in CCQ role | Marks one of the caller's own notifications read (another user's is 404) |
| POST | `/api/v1/notifications/read` | `authenticated` | any signed-in CCQ role | Marks the caller's own notifications read |
| GET | `/api/v1/overrides` | `override.approve` | SalesLeader, EngLead (priority_tier, queue_position), Admin |  |
| POST | `/api/v1/overrides/:id/approve` | `override.approve` | SalesLeader, EngLead (priority_tier, queue_position), Admin |  |
| POST | `/api/v1/overrides/:id/reject` | `override.approve` | SalesLeader, EngLead (priority_tier, queue_position), Admin |  |
| POST | `/api/v1/overrides/:id/revert` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/pricing/erf/:erfNumber` | `quote.read.commercialFields` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward |  |
| GET | `/api/v1/pricing/history` | `quote.read.commercialFields` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward |  |
| GET | `/api/v1/queue/engineering` | `engQueue.read` | EngLead, Engineer, Leadership, Admin |  |
| POST | `/api/v1/queue/engineering/reassign` | `queue.assign` | EngLead, Admin |  |
| GET | `/api/v1/queue/pricing` | `pricingQueue.read` | Pricing, PricingLead, Leadership, Admin |  |
| POST | `/api/v1/queue/pricing/reassign` | `pricingQueue.assign` | PricingLead, Admin |  |
| GET | `/api/v1/quotes` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/quotes/:quoteNumber` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| POST | `/api/v1/quotes/:quoteNumber/assignment` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/quotes/:quoteNumber/attachments` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| POST | `/api/v1/quotes/:quoteNumber/attachments` | `attachment.upload` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead |  |
| PUT | `/api/v1/quotes/:quoteNumber/capacity-evidence` | `engReview.edit` | EngLead, Engineer (assigned) |  |
| PUT | `/api/v1/quotes/:quoteNumber/capacity-signoff` | `capacity.signoff` | EngLead |  |
| PUT | `/api/v1/quotes/:quoteNumber/capital-flag` | `capitalFlag.edit` | KAM (own), SalesLeader, EngLead, Engineer (assigned), Pricing, PricingLead |  |
| PUT | `/api/v1/quotes/:quoteNumber/capital-readiness` | `quoting.edit` | Pricing, PricingLead |  |
| POST | `/api/v1/quotes/:quoteNumber/comments` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| PUT | `/api/v1/quotes/:quoteNumber/eng-review` | `engReview.edit` | EngLead, Engineer (assigned) |  |
| POST | `/api/v1/quotes/:quoteNumber/eng-review/accept` | `engReview.edit` | EngLead, Engineer (assigned) |  |
| POST | `/api/v1/quotes/:quoteNumber/eng-review/send-back` | `gate.G2.decide` | EngLead |  |
| POST | `/api/v1/quotes/:quoteNumber/eng-review/submit` | `engReview.edit` | EngLead, Engineer (assigned) |  |
| POST | `/api/v1/quotes/:quoteNumber/escalations` | `quote.escalate` | KAM (own), SalesLeader, EngLead, Engineer (assigned), Pricing, PricingLead, Approver, Admin |  |
| POST | `/api/v1/quotes/:quoteNumber/gates/:gateKey/decisions` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| PUT | `/api/v1/quotes/:quoteNumber/handoff` | `handoff.edit` | KAM (own), SalesLeader, Admin |  |
| GET | `/api/v1/quotes/:quoteNumber/overrides` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| POST | `/api/v1/quotes/:quoteNumber/overrides` | `override.request` | KAM, SalesLeader, EngLead, Pricing, PricingLead |  |
| POST | `/api/v1/quotes/:quoteNumber/pricing-assignment` | `pricingQueue.assign` | PricingLead, Admin |  |
| GET | `/api/v1/quotes/:quoteNumber/pricing-context` | `quote.read.commercialFields` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward |  |
| PUT | `/api/v1/quotes/:quoteNumber/pricing-record` | `quoting.edit` | Pricing, PricingLead |  |
| POST | `/api/v1/quotes/:quoteNumber/quoting/send-back` | `gate.G3.submit` | PricingLead |  |
| POST | `/api/v1/quotes/:quoteNumber/quoting/submit` | `quoting.edit` | Pricing, PricingLead |  |
| GET | `/api/v1/quotes/:quoteNumber/review-summary` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| POST | `/api/v1/quotes/:quoteNumber/rework` | `quote.create` | KAM, SalesLeader, Admin |  |
| GET | `/api/v1/quotes/:quoteNumber/stage-times` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| PUT | `/api/v1/quotes/:quoteNumber/terms` | `terms.edit` | KAM (own), SalesLeader, Pricing, PricingLead |  |
| GET | `/api/v1/quotes/:quoteNumber/timeline` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/quotes/board` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/quotes/drafts` | `quote.create` | KAM, SalesLeader, Admin |  |
| POST | `/api/v1/quotes/drafts` | `quote.create` | KAM, SalesLeader, Admin |  |
| DELETE | `/api/v1/quotes/drafts/:id` | `quote.create` | KAM, SalesLeader, Admin |  |
| GET | `/api/v1/quotes/drafts/:id` | `quote.create` | KAM, SalesLeader, Admin |  |
| PATCH | `/api/v1/quotes/drafts/:id` | `quote.create` | KAM, SalesLeader, Admin |  |
| GET | `/api/v1/quotes/drafts/:id/attachments` | `quote.create` | KAM, SalesLeader, Admin |  |
| POST | `/api/v1/quotes/drafts/:id/attachments` | `quote.create` | KAM, SalesLeader, Admin |  |
| POST | `/api/v1/quotes/drafts/:id/submit` | `quote.create` | KAM, SalesLeader, Admin |  |
| GET | `/api/v1/quotes/export.csv` | `export.csv` | KAM, SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin |  |
| GET | `/api/v1/quotes/mine/proposals` | `outcome.record` | KAM (own), SalesLeader |  |
| GET | `/api/v1/salesforce/opportunities` | `quote.create` | KAM, SalesLeader, Admin |  |
| GET | `/api/v1/salesforce/opportunities/:id` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |
| GET | `/api/v1/users` | `quote.read` | KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin, PostAward (AWARDED) |  |

## Permissions checked in services

These matrix permissions are not a route gate; the service checks them against the resource.

| Permission | Holders | Where, and the test that proves it |
| --- | --- | --- |
| `gate.G1.decide` | SalesLeader | POST /quotes/:quoteNumber/gates/G1/decisions (floor quote.read): gates.int.test.ts |
| `gate.G4.decide` | Approver | POST /quotes/:quoteNumber/gates/G4/decisions (floor quote.read): final-review.int.test.ts |
| `gate.G6.decide` | KAM (own), SalesLeader | POST /quotes/:quoteNumber/gates/G6/decisions (floor quote.read): outcome.int.test.ts |
| `outcome.assignOwner` | SalesLeader | G5 decision closureOwnerId other than the KAM (floor quote.read): outcome.int.test.ts |
| `override.revert` | SalesLeader, EngLead, Admin | POST /overrides/:id/revert (floor quote.read): overrides.int.test.ts |
| `attachment.removeAny` | Admin | DELETE /attachments/:id (floor quote.read): attachments.int.test.ts |
