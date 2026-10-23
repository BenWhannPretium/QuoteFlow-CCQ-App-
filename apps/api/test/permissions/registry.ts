import type { Permission } from '@ccq/domain';

import type { RoutePermission } from '../../src/plugins/auth';

/**
 * Every /api route, with the permission it declares and a valid sample request.
 * The matrix test fails if a registered route is missing here, so add each new route as you build it.
 * `url` is the concrete URL to call (fill path params with sample ids); `route` is the Fastify pattern.
 */
const SAMPLE_DRAFT_ID = '019a0000-0000-7000-8000-00000000d7a1';
/** A well-formed quote number no seed uses, so allowed roles get 404 (not 403). */
const SAMPLE_QUOTE = 'CCQ-2099-99999';
/** An override id nothing uses, so allowed roles get 404 (not 403). */
const SAMPLE_OVERRIDE = '019a0000-0000-7000-8000-0000000000e1';
/** A notification id nothing uses, so every role gets 404 (it is nobody's). */
const SAMPLE_NOTIFICATION = '019a0000-0000-7000-8000-0000000000b8';
/** An attachment id nothing uses, so allowed roles get 404 (not 403). */
const SAMPLE_ATTACHMENT = '019a0000-0000-7000-8000-0000000000a7';
/** A config row / user id nothing uses, so allowed roles get 404 (not 403). */
const SAMPLE_CONFIG_ID = '019a0000-0000-7000-8000-0000000000c0';

export interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  route: string;
  url?: string;
  permission: RoutePermission | 'public';
  /**
   * A permission the service checks on top of the route's own (B-17 `/dashboards/:role` opens a role's
   * dashboard only with the permission behind it). Roles without it are denied (403), not just those
   * without the route's permission.
   */
  requires?: Permission;
  sampleBody?: unknown;
}

export const ROUTE_REGISTRY: RegisteredRoute[] = [
  { method: 'GET', route: '/api/v1/health', permission: 'public' },
  { method: 'GET', route: '/api/v1/auth/config', permission: 'public' },
  { method: 'GET', route: '/api/v1/me', permission: 'authenticated' },
  { method: 'GET', route: '/api/v1/config/public', permission: 'quote.read' },
  // B-06 Salesforce (SF_MODE=fake in tests). The detail id is a syntactically valid id that
  // neither the snapshot nor the fake knows, so allowed roles get 404 (not 403).
  {
    method: 'GET',
    route: '/api/v1/salesforce/opportunities',
    url: '/api/v1/salesforce/opportunities?q=packaging&openOnly=true',
    permission: 'quote.create',
  },
  {
    method: 'GET',
    route: '/api/v1/salesforce/opportunities/:id',
    url: '/api/v1/salesforce/opportunities/006000000000000AAA',
    permission: 'quote.read',
  },
  // The matrix app has a database, so the allowed POST runs a real sync against the fake reader.
  { method: 'POST', route: '/api/v1/admin/salesforce/sync', permission: 'config.manage' },
  { method: 'GET', route: '/api/v1/admin/integrations', permission: 'config.read' },
  { method: 'GET', route: '/api/v1/admin/reports/erf-linkage', permission: 'config.manage' },
  // B-19 admin configuration console: reads config.read (Leadership + Admin), writes config.manage.
  // Sample write bodies fail validation (400) or name nothing (404), so the matrix changes no config.
  { method: 'GET', route: '/api/v1/admin/integrations/health', permission: 'config.read' },
  { method: 'GET', route: '/api/v1/admin/config/value-lists', permission: 'config.read' },
  {
    method: 'POST',
    route: '/api/v1/admin/config/value-lists',
    permission: 'config.manage',
    sampleBody: { listKey: 'resin', code: 'X', label: 'X', changeReason: '' },
  },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/value-lists/:id',
    url: `/api/v1/admin/config/value-lists/${SAMPLE_CONFIG_ID}`,
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', label: 'x' },
  },
  {
    method: 'PUT',
    route: '/api/v1/admin/config/value-lists/:listKey/order',
    url: '/api/v1/admin/config/value-lists/resin/order',
    permission: 'config.manage',
    sampleBody: { items: [], changeReason: 'matrix test' },
  },
  { method: 'GET', route: '/api/v1/admin/config/reason-codes', permission: 'config.read' },
  {
    method: 'POST',
    route: '/api/v1/admin/config/reason-codes',
    permission: 'config.manage',
    sampleBody: { context: 'lost', code: 'X', label: 'X', changeReason: '' },
  },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/reason-codes/:id',
    url: `/api/v1/admin/config/reason-codes/${SAMPLE_CONFIG_ID}`,
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', label: 'x' },
  },
  {
    method: 'PUT',
    route: '/api/v1/admin/config/reason-codes/:context/order',
    url: '/api/v1/admin/config/reason-codes/lost/order',
    permission: 'config.manage',
    sampleBody: { items: [], changeReason: 'matrix test' },
  },
  { method: 'GET', route: '/api/v1/admin/config/workflow', permission: 'config.read' },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/stages/:key',
    url: '/api/v1/admin/config/stages/NO_SUCH_STAGE',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', label: 'x' },
  },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/gates/:key',
    url: '/api/v1/admin/config/gates/NO_SUCH_GATE',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', label: 'x' },
  },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/gates/:gateKey/outcomes/:key',
    url: '/api/v1/admin/config/gates/G1/outcomes/no_such_outcome',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', label: 'x' },
  },
  { method: 'GET', route: '/api/v1/admin/config/settings', permission: 'config.read' },
  {
    method: 'PATCH',
    route: '/api/v1/admin/config/settings/:key',
    url: '/api/v1/admin/config/settings/no_such_setting',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: 'matrix test', value: 1 },
  },
  { method: 'GET', route: '/api/v1/admin/config/scoring', permission: 'config.read' },
  {
    method: 'POST',
    route: '/api/v1/admin/config/scoring/preview',
    permission: 'config.read',
    sampleBody: { model: { attributes: [], tiers: [], unknownScore: 50 } },
  },
  {
    method: 'POST',
    route: '/api/v1/admin/config/scoring/draft',
    permission: 'config.manage',
    sampleBody: { changeReason: '' },
  },
  {
    method: 'PUT',
    route: '/api/v1/admin/config/scoring/draft',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: '', model: {} },
  },
  {
    method: 'POST',
    route: '/api/v1/admin/config/scoring/draft/activate',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: '' },
  },
  {
    method: 'POST',
    route: '/api/v1/admin/config/scoring/draft/discard',
    permission: 'config.manage',
    sampleBody: { version: 1, changeReason: '' },
  },
  { method: 'GET', route: '/api/v1/admin/users', permission: 'config.read' },
  {
    method: 'PUT',
    route: '/api/v1/admin/users/:id/scope',
    url: `/api/v1/admin/users/${SAMPLE_CONFIG_ID}/scope`,
    permission: 'config.manage',
    sampleBody: { version: null, changeReason: '', type: 'all' },
  },
  { method: 'GET', route: '/api/v1/admin/config/decision-log', permission: 'config.read' },
  {
    method: 'GET',
    route: '/api/v1/admin/config/decision-log/export.csv',
    permission: 'config.read',
  },
  // B-07 intake drafts. The sample id is a draft nobody owns, so allowed roles get 404 (not 403);
  // the allowed POST creates a real (empty) draft for the caller.
  {
    method: 'POST',
    route: '/api/v1/quotes/drafts',
    permission: 'quote.create',
    sampleBody: { data: {} },
  },
  { method: 'GET', route: '/api/v1/quotes/drafts', permission: 'quote.create' },
  {
    method: 'GET',
    route: '/api/v1/quotes/drafts/:id',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}`,
    permission: 'quote.create',
  },
  {
    method: 'PATCH',
    route: '/api/v1/quotes/drafts/:id',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}`,
    permission: 'quote.create',
    sampleBody: { step: 2 },
  },
  {
    method: 'DELETE',
    route: '/api/v1/quotes/drafts/:id',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}`,
    permission: 'quote.create',
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/drafts/:id/submit',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}/submit`,
    permission: 'quote.create',
  },
  // B-08 quote reads, rework and the generic gate-decision route. The route floor is quote.read;
  // the gate's decider permission is checked by the domain (see gates.int.test.ts for "only
  // SalesLeader decides G1").
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/rework',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/rework`,
    permission: 'quote.create',
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}`,
    permission: 'quote.read',
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/gates/:gateKey/decisions',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/gates/G1/decisions`,
    permission: 'quote.read',
    sampleBody: { outcomeKey: 'advance' },
  },
  {
    method: 'GET',
    route: '/api/v1/gates/:gateKey/queue',
    url: '/api/v1/gates/G1/queue',
    permission: 'quote.read',
  },
  // B-09 governed overrides. Floors are matrix permissions; the per-field approver config and segregation
  // are domain checks (overrides.int.test.ts). Revert's floor is quote.read: a KAM may revert a
  // self-applied ship-to they made.
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/overrides',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/overrides`,
    permission: 'override.request',
    sampleBody: { field: 'priority_tier', requestedValue: 'HIGH', justification: 'x'.repeat(20) },
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/overrides',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/overrides`,
    permission: 'quote.read',
  },
  { method: 'GET', route: '/api/v1/overrides', permission: 'override.approve' },
  {
    method: 'POST',
    route: '/api/v1/overrides/:id/approve',
    url: `/api/v1/overrides/${SAMPLE_OVERRIDE}/approve`,
    permission: 'override.approve',
    sampleBody: {},
  },
  {
    method: 'POST',
    route: '/api/v1/overrides/:id/reject',
    url: `/api/v1/overrides/${SAMPLE_OVERRIDE}/reject`,
    permission: 'override.approve',
    sampleBody: { note: 'no' },
  },
  {
    method: 'POST',
    route: '/api/v1/overrides/:id/revert',
    url: `/api/v1/overrides/${SAMPLE_OVERRIDE}/revert`,
    permission: 'quote.read',
  },
  { method: 'GET', route: '/api/v1/admin/override-log', permission: 'overrideLog.read' },
  // B-09 timeline, comments and the @mention picker.
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/timeline',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/timeline`,
    permission: 'quote.read',
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/comments',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/comments`,
    permission: 'quote.read',
    sampleBody: { body: 'hello' },
  },
  {
    method: 'GET',
    route: '/api/v1/users',
    url: '/api/v1/users?q=a',
    permission: 'quote.read',
  },
  // B-09 usage audit (audit.read = Leadership + Admin).
  { method: 'GET', route: '/api/v1/admin/audit', permission: 'audit.read' },
  { method: 'GET', route: '/api/v1/admin/audit/export.csv', permission: 'audit.read' },
  { method: 'GET', route: '/api/v1/admin/reports/usage', permission: 'audit.read' },
  // B-10 engineering queue and Engineering Review. The queue needs engQueue.read. Assignment's floor
  // is quote.read (a backup assigner may hold no queue.assign); the domain then requires queue.assign
  // or the backup setting (engineering.int.test.ts: KAM 403, Engineer 403). Accept / edit need
  // engReview.edit; "an Engineer edits only quotes assigned to them" is engineering.int.test.ts.
  { method: 'GET', route: '/api/v1/queue/engineering', permission: 'engQueue.read' },
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/assignment',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/assignment`,
    permission: 'quote.read',
    sampleBody: { engineerId: SAMPLE_OVERRIDE },
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/eng-review/accept',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/eng-review/accept`,
    permission: 'engReview.edit',
  },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/eng-review',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/eng-review`,
    permission: 'engReview.edit',
    sampleBody: { cavitation: 4 },
  },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/capacity-evidence',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/capacity-evidence`,
    permission: 'engReview.edit',
    sampleBody: { rows: [] },
  },
  // B-26: the capacity owner's sign-off, and moving one engineer's open work to another.
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/capacity-signoff',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/capacity-signoff`,
    permission: 'capacity.signoff',
    sampleBody: { status: 'approved' },
  },
  {
    method: 'POST',
    route: '/api/v1/queue/engineering/reassign',
    permission: 'queue.assign',
    sampleBody: { fromUserId: SAMPLE_CONFIG_ID, toUserId: SAMPLE_OVERRIDE },
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/stage-times',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/stage-times`,
    permission: 'quote.read',
  },
  // B-18 notifications and email preferences: everything is the caller's own, so every signed-in role
  // is allowed; notifications.int.test.ts proves one user can never read or mark another's.
  { method: 'GET', route: '/api/v1/notifications', permission: 'authenticated' },
  { method: 'POST', route: '/api/v1/notifications/read', permission: 'authenticated' },
  {
    method: 'POST',
    route: '/api/v1/notifications/:id/read',
    url: `/api/v1/notifications/${SAMPLE_NOTIFICATION}/read`,
    permission: 'authenticated',
  },
  { method: 'GET', route: '/api/v1/me/preferences', permission: 'authenticated' },
  {
    method: 'PUT',
    route: '/api/v1/me/preferences',
    permission: 'authenticated',
    sampleBody: { email: { 'quote.assigned': true } },
  },
  // B-11 pricing queue and Quoting tab. The queue needs pricingQueue.read (Pricing, Leadership,
  // Admin); the PUTs need quoting.edit (Pricing). "Only while in Quoting", the field checks and the
  // commercial redaction of QuoteDetail.quoting for every other role are pricing.int.test.ts.
  { method: 'GET', route: '/api/v1/queue/pricing', permission: 'pricingQueue.read' },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/pricing-record',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/pricing-record`,
    permission: 'quoting.edit',
    sampleBody: { pricingBasisNote: 'March CDI' },
  },
  // B-26: the pricing lead assigns Quoting work, one quote or a pricer's whole load.
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/pricing-assignment',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/pricing-assignment`,
    permission: 'pricingQueue.assign',
    sampleBody: { pricerId: SAMPLE_OVERRIDE },
  },
  {
    method: 'POST',
    route: '/api/v1/queue/pricing/reassign',
    permission: 'pricingQueue.assign',
    sampleBody: { fromUserId: SAMPLE_CONFIG_ID, toUserId: SAMPLE_OVERRIDE },
  },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/capital-readiness',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/capital-readiness`,
    permission: 'quoting.edit',
    sampleBody: { capitalReadiness: 'pending' },
  },
  // B-15 pricing history (revised: the imported legacy export, no live connection). Reads are
  // commercial (quote.read.commercialFields); KAM, Engineer and SalesLeader get 403. The sample ERF
  // number is unknown, so allowed roles get 404. The import and its status are config.manage (Admin);
  // the allowed POST sends no file, so it gets 422. Context, search, import and redaction:
  // pricing-history.int.test.ts.
  {
    method: 'GET',
    route: '/api/v1/pricing/erf/:erfNumber',
    url: '/api/v1/pricing/erf/ERF99-999',
    permission: 'quote.read.commercialFields',
  },
  {
    method: 'GET',
    route: '/api/v1/pricing/history',
    url: '/api/v1/pricing/history?kind=bpr&customer=synthetic',
    permission: 'quote.read.commercialFields',
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/pricing-context',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/pricing-context`,
    permission: 'quote.read.commercialFields',
  },
  { method: 'GET', route: '/api/v1/admin/pricing-history', permission: 'config.manage' },
  {
    method: 'POST',
    route: '/api/v1/admin/pricing-history/import',
    permission: 'config.manage',
    sampleBody: {},
  },
  // B-12 Final Review. The queue is finalReview.read (Approver, Leadership, Admin); the summary is the
  // quote.read floor (commercial parts are redacted per role: final-review.int.test.ts). G4 decisions
  // are the generic gate route above, whose own decider checks are gates.int.test.ts / final-review.int.test.ts.
  { method: 'GET', route: '/api/v1/approvals', permission: 'finalReview.read' },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/review-summary',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/review-summary`,
    permission: 'quote.read',
  },
  // B-13 customer decision. "My open proposals" is the KAM's own list (outcome.record: KAM own +
  // SalesLeader). The hand-off floor is handoff.edit (KAM own, SalesLeader, Admin); the service checks
  // the quote again (outcome.int.test.ts), so allowed roles get 404 on the sample quote. G5 decisions
  // are the generic gate route above.
  { method: 'GET', route: '/api/v1/quotes/mine/proposals', permission: 'outcome.record' },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/handoff',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/handoff`,
    permission: 'handoff.edit',
    sampleBody: { notes: 'x' },
  },
  { method: 'GET', route: '/api/v1/admin/reports/outcomes', permission: 'analytics.read' },
  // B-26 commercial: capital flag, terms + Legal review, escalations. KAM grants are own-quote and an
  // Engineer's assigned-quote; the service checks the quote, so allowed roles get 404 on the sample.
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/capital-flag',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/capital-flag`,
    permission: 'capitalFlag.edit',
    sampleBody: { capitalLikely: true },
  },
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/terms',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/terms`,
    permission: 'terms.edit',
    sampleBody: { termsMoq: '50k' },
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/escalations',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/escalations`,
    permission: 'quote.escalate',
    sampleBody: { code: 'process', note: 'x' },
  },
  // B-14 pipeline views. List and board are the quote.read floor (scope + redaction:
  // pipeline.int.test.ts); the CSV export is export.csv (every role but Engineer).
  {
    method: 'GET',
    route: '/api/v1/quotes',
    url: '/api/v1/quotes?pageSize=1',
    permission: 'quote.read',
  },
  { method: 'GET', route: '/api/v1/quotes/board', permission: 'quote.read' },
  {
    method: 'GET',
    route: '/api/v1/quotes/export.csv',
    url: '/api/v1/quotes/export.csv?stage=INTAKE',
    permission: 'export.csv',
  },
  // B-16 attachments. Uploads are attachment.upload (quote) / quote.create (draft); without a
  // multipart body an allowed role gets 415 (the service then checks scope and the draft owner:
  // attachments.int.test.ts). Read, download and remove are the quote.read floor; the service checks
  // the quote's scope, the uploader / 24 h window and attachment.removeAny. The local-store link is
  // public: its HMAC-signed token is the authorization (an unsigned one is 404).
  {
    method: 'POST',
    route: '/api/v1/quotes/:quoteNumber/attachments',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/attachments`,
    permission: 'attachment.upload',
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/attachments',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/attachments`,
    permission: 'quote.read',
  },
  {
    method: 'POST',
    route: '/api/v1/quotes/drafts/:id/attachments',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}/attachments`,
    permission: 'quote.create',
  },
  {
    method: 'GET',
    route: '/api/v1/quotes/drafts/:id/attachments',
    url: `/api/v1/quotes/drafts/${SAMPLE_DRAFT_ID}/attachments`,
    permission: 'quote.create',
  },
  {
    method: 'GET',
    route: '/api/v1/attachments/:id/download',
    url: `/api/v1/attachments/${SAMPLE_ATTACHMENT}/download`,
    permission: 'quote.read',
  },
  {
    method: 'DELETE',
    route: '/api/v1/attachments/:id',
    url: `/api/v1/attachments/${SAMPLE_ATTACHMENT}`,
    permission: 'quote.read',
  },
  {
    method: 'GET',
    route: '/api/v1/files/local',
    url: '/api/v1/files/local?t=not-a-signed-token',
    permission: 'public',
  },
  // B-17 operational analytics: one endpoint per chart. analytics.read (SalesLeader, EngLead, Pricing,
  // Approver, Leadership, Admin); adoption reads the audit log, so it needs audit.read.
  { method: 'GET', route: '/api/v1/analytics/filters', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/pipeline', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/cycle-time', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/flow', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/outcomes', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/first-pass', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/g1-yield', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/overrides', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/gate-compliance', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/priority', permission: 'analytics.read' },
  { method: 'GET', route: '/api/v1/analytics/adoption', permission: 'audit.read' },
  // B-26 (A5): the Engineering lens, for the people who read the engineering queue.
  { method: 'GET', route: '/api/v1/analytics/engineering', permission: 'engQueue.read' },
  // Role dashboards: the floor is quote.read; the Leadership dashboard needs analytics.read on top
  // (the other six roles' dashboards are covered in analytics.int.test.ts).
  {
    method: 'GET',
    route: '/api/v1/dashboards/:role',
    url: '/api/v1/dashboards/Leadership',
    permission: 'quote.read',
    requires: 'analytics.read',
  },
];
