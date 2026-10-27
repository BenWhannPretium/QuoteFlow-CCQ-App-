import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERMISSION_MATRIX, PERMISSIONS, ROLES, type Permission } from '@ccq/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  renderRouteInventory,
  SERVICE_CHECKED_PERMISSIONS,
} from '../../../test/permissions/inventory';
import { ROUTE_REGISTRY } from '../../../test/permissions/registry';
import { buildApp } from '../../app';
import { fakeDb, testConfig } from '../../test-utils';

/**
 * B-21 static layer of the permission-matrix suite (no database; runs with `pnpm test`).
 * Every route Fastify registers under /api must be in the registry with the permission it declares,
 * that permission must exist in the matrix and be held by at least one role, and the routes that need
 * no matrix permission (public, any signed-in role) must say why. The integration layer
 * (`test/permissions/matrix.int.test.ts`) then sends every route as every role.
 */
const INVENTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../docs/security/route-inventory.md',
);

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp(testConfig(), { db: fakeDb() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const isMatrixPermission = (p: string): p is Permission =>
  (PERMISSIONS as readonly string[]).includes(p);

describe('route registry (static)', () => {
  it('matches the routes Fastify registers, with the permission each declares', () => {
    const registered = app.apiRoutes.map((r) => `${r.method} ${r.url} ${r.permission}`).sort();
    const listed = ROUTE_REGISTRY.map((r) => `${r.method} ${r.route} ${r.permission}`).sort();
    expect(listed).toEqual(registered);
  });

  it('lists each route once', () => {
    const keys = ROUTE_REGISTRY.map((r) => `${r.method} ${r.route}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('gates every route with a matrix permission that some role holds, or says why not', () => {
    const problems: string[] = [];
    for (const r of ROUTE_REGISTRY) {
      const id = `${r.method} ${r.route}`;
      if (r.permission === 'public' || r.permission === 'authenticated') {
        if (!r.reason?.trim()) problems.push(`${id}: ${r.permission} without a reason`);
        continue;
      }
      if (!isMatrixPermission(r.permission)) {
        problems.push(`${id}: unknown permission ${String(r.permission)}`);
        continue;
      }
      if (Object.keys(PERMISSION_MATRIX[r.permission]).length === 0) {
        problems.push(`${id}: no role holds ${r.permission}`);
      }
      if (r.requires && !isMatrixPermission(r.requires)) {
        problems.push(`${id}: requires unknown permission ${String(r.requires)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the intentionally public routes to the reviewed allow-list', () => {
    // Adding a public route is a security decision: change this list in the same PR, with a reason
    // in the registry.
    expect(
      ROUTE_REGISTRY.filter((r) => r.permission === 'public')
        .map((r) => `${r.method} ${r.route}`)
        .sort(),
    ).toEqual(['GET /api/v1/auth/config', 'GET /api/v1/files/local', 'GET /api/v1/health']);
  });

  it('fills every path parameter of the sample request', () => {
    const problems: string[] = [];
    for (const r of ROUTE_REGISTRY) {
      const target = (r.url ?? r.route).split('?')[0]!;
      const pattern = new RegExp(`^${r.route.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
      if (target.includes(':') || !pattern.test(target)) {
        problems.push(`${r.method} ${r.route}: sample url ${r.url ?? '(none)'}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('permission matrix (static)', () => {
  it('grants only known roles', () => {
    for (const p of PERMISSIONS) {
      for (const role of Object.keys(PERMISSION_MATRIX[p])) expect(ROLES).toContain(role);
    }
  });

  it('enforces every permission somewhere: as a route gate, or in a named service check', () => {
    const declared = new Set<string>(
      ROUTE_REGISTRY.flatMap((r) => [r.permission, ...(r.requires ? [r.requires] : [])]),
    );
    const unused = PERMISSIONS.filter((p) => !declared.has(p)).sort();
    expect(unused).toEqual(Object.keys(SERVICE_CHECKED_PERMISSIONS).sort());
  });
});

describe('route inventory (docs/security/route-inventory.md)', () => {
  it('is up to date', () => {
    const expected = renderRouteInventory(ROUTE_REGISTRY);
    if (process.env.UPDATE_ROUTE_INVENTORY === '1') {
      mkdirSync(dirname(INVENTORY), { recursive: true });
      writeFileSync(INVENTORY, expected);
    }
    let actual = '';
    try {
      actual = readFileSync(INVENTORY, 'utf8');
    } catch {
      // missing: fails below
    }
    expect(
      actual,
      'Stale route inventory: UPDATE_ROUTE_INVENTORY=1 pnpm --filter @ccq/api test routeMatrix',
    ).toBe(expected);
  });
});
