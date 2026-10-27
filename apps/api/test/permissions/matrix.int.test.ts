import { holdsPermission, type Permission, type Role } from '@ccq/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anonymous, asRole } from './asRole';
import { ROUTE_REGISTRY, type RegisteredRoute } from './registry';
import { buildApp } from '../../src/app';
import { testConfig } from '../../src/test-utils';
import { freshSfDatabase } from '../sf-helpers';

/**
 * B-21 permission matrix: every /api route × every role, allowed AND denied, plus an anonymous sweep.
 *
 * - The registry must equal what Fastify registers (here and, without a database, in
 *   `src/routes/v1/routeMatrix.test.ts`), so a new route fails CI until it is listed.
 * - Allowed: not 401/403 and not a server error (400/404/409/415/422 are fine: the sample ids name
 *   nothing and sample bodies are built to fail validation before any side effect).
 * - Denied: 403 problem+json naming the permission the route gate (or its `requires`) checked, so
 *   the deny provably comes from the gate, not from a later service check.
 * - Anonymous: 401 problem+json for every route that is not public.
 * - Every request must reach the route under test (a sample URL that matched a sibling route, such
 *   as `/quotes/mine/...` vs `/quotes/:quoteNumber/...`, would test the wrong gate).
 *
 * Not covered here, by design: qualified grants (KAM "own", Engineer "assigned", EngLead override
 * "fields", PostAward "stages") and data scope. They pass the route gate and are enforced per
 * resource by `assertCan` in the services and by Postgres RLS; the per-feature integration tests
 * (outcome, engineering, overrides, pipeline, ...) prove them with owner/non-owner quotes. Neither is
 * PostAward: it is P2 and has no dev persona yet (its single grant is `quote.read` on AWARDED quotes).
 */

/** The nine MVP roles (B-26 added PricingLead; PostAward is P2 and has no persona yet). */
const ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Approver',
  'Leadership',
  'Admin',
];

const holds = (role: Role, p: Permission) => holdsPermission({ roles: [role] }, p);

const allowed = (r: RegisteredRoute, role: Role) =>
  r.permission === 'public' ||
  r.permission === 'authenticated' ||
  (holds(role, r.permission) && (!r.requires || holds(role, r.requires)));

/** The permission a denied role is refused on: the route's own gate first, then `requires`. */
const deniedOn = (r: RegisteredRoute, role: Role): string =>
  r.permission !== 'public' && r.permission !== 'authenticated' && !holds(role, r.permission)
    ? r.permission
    : r.requires!;

const MATCHED = 'x-test-matched-route';
const isProblem = (res: LightMyRequestResponse) =>
  String(res.headers['content-type']).startsWith('application/problem+json');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  // Its own database, config-seeded with the synthetic data, so allowed requests run against real
  // config (a 5xx is a finding) and the side-effecting samples touch nothing other files use.
  const { url, client: db } = await freshSfDatabase('matrix');
  // The matrix makes ~9 requests per registered route from one client: keep it clear of the rate limit.
  app = await buildApp(testConfig({ DATABASE_URL: url, RATE_LIMIT_MAX: '100000' }), { db });
  // Test-only: report which route pattern handled each request.
  app.addHook('onSend', async (req, reply) => {
    if (req.routeOptions.url) void reply.header(MATCHED, req.routeOptions.url);
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('route registry', () => {
  it('lists every /api route with the permission it declares', () => {
    const key = (m: string, u: string) => `${m} ${u}`;
    const registered = app.apiRoutes.map((r) => `${key(r.method, r.url)} ${r.permission}`).sort();
    const listed = ROUTE_REGISTRY.map((r) => `${key(r.method, r.route)} ${r.permission}`).sort();
    expect(listed).toEqual(registered);
  });
});

describe.each(ROUTE_REGISTRY)('$method $route ($permission)', (r) => {
  const target = r.url ?? r.route;

  it.each(ROLES)('%s', async (role) => {
    const res = await asRole(app, role).request(r.method, target, r.sampleBody);
    expect(res.headers[MATCHED], 'sample URL reached another route').toBe(r.route);
    if (allowed(r, role)) {
      expect(res.statusCode, `${role} should be allowed: ${res.body}`).not.toBe(403);
      expect(res.statusCode, `${role} should be signed in: ${res.body}`).not.toBe(401);
      expect(res.statusCode, `${role} got a server error: ${res.body}`).toBeLessThan(500);
    } else {
      expect(res.statusCode, `${role} should be denied: ${res.body}`).toBe(403);
      expect(isProblem(res), 'a 403 is problem+json').toBe(true);
      const body = res.json<{ permission?: string; detail?: string }>();
      const on = deniedOn(r, role);
      // The route gate names the permission; a `requires` check in the service says it in the detail.
      if (on === r.permission) expect(body.permission).toBe(on);
      else expect(body.detail).toContain(on);
    }
  });

  it('anonymous', async () => {
    const res = await anonymous(app, r.method, target);
    expect(res.headers[MATCHED], 'sample URL reached another route').toBe(r.route);
    if (r.permission === 'public') {
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).toBeLessThan(500);
    } else {
      expect(res.statusCode).toBe(401);
      expect(isProblem(res), 'a 401 is problem+json').toBe(true);
    }
  });
});
