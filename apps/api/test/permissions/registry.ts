import type { RoutePermission } from '../../src/plugins/auth';

/**
 * Every /api route, with the permission it declares and a valid sample request.
 * The matrix test fails if a registered route is missing here, so add each new route as you build it.
 * `url` is the concrete URL to call (fill path params with sample ids); `route` is the Fastify pattern.
 */
const SAMPLE_DRAFT_ID = '019a0000-0000-7000-8000-00000000d7a1';

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
];
