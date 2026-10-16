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

export interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  route: string;
  url?: string;
  permission: RoutePermission | 'public';
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
  { method: 'GET', route: '/api/v1/admin/integrations', permission: 'config.manage' },
  { method: 'GET', route: '/api/v1/admin/reports/erf-linkage', permission: 'config.manage' },
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
  {
    method: 'GET',
    route: '/api/v1/quotes/:quoteNumber/stage-times',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/stage-times`,
    permission: 'quote.read',
  },
  { method: 'GET', route: '/api/v1/notifications', permission: 'authenticated' },
  { method: 'POST', route: '/api/v1/notifications/read', permission: 'authenticated' },
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
  {
    method: 'PUT',
    route: '/api/v1/quotes/:quoteNumber/capital-readiness',
    url: `/api/v1/quotes/${SAMPLE_QUOTE}/capital-readiness`,
    permission: 'quoting.edit',
    sampleBody: { capitalReadiness: 'pending' },
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
];
