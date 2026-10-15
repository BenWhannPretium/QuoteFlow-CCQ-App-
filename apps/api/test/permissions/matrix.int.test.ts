import { createDb, type DbClient } from '@ccq/db';
import { holdsPermission, type Role } from '@ccq/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anonymous, asRole } from './asRole';
import { ROUTE_REGISTRY, type RegisteredRoute } from './registry';
import { buildApp } from '../../src/app';
import { testConfig } from '../../src/test-utils';

/** The eight MVP roles (PostAward is P2 and has no persona yet). */
const ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'Approver',
  'Leadership',
  'Admin',
];

const allowed = (r: RegisteredRoute, role: Role) =>
  r.permission === 'public' ||
  r.permission === 'authenticated' ||
  holdsPermission({ roles: [role] }, r.permission);

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq_test';
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  db = createDb(url);
  app = await buildApp(testConfig({ DATABASE_URL: url }), { db });
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
    if (allowed(r, role)) {
      expect(res.statusCode, `${role} should be allowed: ${res.body}`).not.toBe(403);
      expect(res.statusCode).not.toBe(401);
    } else {
      expect(res.statusCode, `${role} should be denied`).toBe(403);
    }
  });

  it('anonymous', async () => {
    const res = await anonymous(app, r.method, target);
    if (r.permission === 'public') expect(res.statusCode).not.toBe(401);
    else expect(res.statusCode).toBe(401);
  });
});
