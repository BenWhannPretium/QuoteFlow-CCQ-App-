import { PERMISSION_MATRIX, type Grant, type Permission, type Role } from '@ccq/domain';

import type { RegisteredRoute } from './registry';

/**
 * Permissions no route declares as its gate: the route's gate is a broader floor (usually
 * `quote.read`) and the service checks these against the quote with `assertCan`. Each names the
 * per-feature integration test that proves the allowed and denied roles. The static matrix test
 * fails if a permission is neither declared by a route nor listed here.
 */
export const SERVICE_CHECKED_PERMISSIONS: Partial<Record<Permission, string>> = {
  'gate.G1.decide':
    'POST /quotes/:quoteNumber/gates/G1/decisions (floor quote.read): gates.int.test.ts',
  'gate.G2.decide':
    'POST /quotes/:quoteNumber/gates/G2/decisions (floor quote.read): engineering.int.test.ts',
  'gate.G3.submit':
    'POST /quotes/:quoteNumber/gates/G3/decisions (floor quote.read): pricing.int.test.ts',
  'gate.G4.decide':
    'POST /quotes/:quoteNumber/gates/G4/decisions (floor quote.read): final-review.int.test.ts',
  'gate.G6.decide':
    'POST /quotes/:quoteNumber/gates/G6/decisions (floor quote.read): outcome.int.test.ts',
  'outcome.assignOwner':
    'G5 decision closureOwnerId other than the KAM (floor quote.read): outcome.int.test.ts',
  'override.revert': 'POST /overrides/:id/revert (floor quote.read): overrides.int.test.ts',
  'attachment.removeAny': 'DELETE /attachments/:id (floor quote.read): attachments.int.test.ts',
};

const describeGrant = (role: Role, grant: Grant): string => {
  if (grant === true) return role;
  switch (grant.kind) {
    case 'own':
      return `${role} (own)`;
    case 'assigned':
      return `${role} (assigned)`;
    case 'fields':
      return `${role} (${grant.fields.join(', ')})`;
    case 'stages':
      return `${role} (${grant.stageKeys.join(', ')})`;
  }
};

/** Who passes the route-level gate, as the inventory prints it. */
export function gateHolders(r: RegisteredRoute): string {
  if (r.permission === 'public') return 'anyone (no sign-in)';
  if (r.permission === 'authenticated') return 'any signed-in CCQ role';
  const grants = PERMISSION_MATRIX[r.permission];
  const required = r.requires ? PERMISSION_MATRIX[r.requires] : undefined;
  const holders = (Object.entries(grants) as [Role, Grant][])
    .filter(([role]) => !required || required[role] !== undefined)
    .map(([role, grant]) => describeGrant(role, grant));
  return holders.join(', ');
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** `docs/security/route-inventory.md`, generated from the registry and the permission matrix. */
export function renderRouteInventory(routes: readonly RegisteredRoute[]): string {
  const sorted = [...routes].sort(
    (a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method),
  );
  const counts = {
    total: routes.length,
    public: routes.filter((r) => r.permission === 'public').length,
    authenticated: routes.filter((r) => r.permission === 'authenticated').length,
  };
  const lines = [
    '# API route inventory',
    '',
    '> Generated from `apps/api/test/permissions/registry.ts` and `packages/domain/src/policy/matrix.ts`.',
    '> **Do not edit by hand.** Regenerate with `UPDATE_ROUTE_INVENTORY=1 pnpm --filter @ccq/api test routeMatrix`.',
    '> `routeMatrix.test.ts` fails if this file is stale, and `test/permissions/matrix.int.test.ts` sends',
    '> every route below as every role (allowed: not 401/403; denied: 403 problem+json) and anonymously (401).',
    '',
    `${counts.total} routes: ${counts.public} public, ${counts.authenticated} for any signed-in role, ` +
      `${counts.total - counts.public - counts.authenticated} gated by a matrix permission.`,
    '',
    'Qualified grants (own, assigned, fields, stages) pass the route gate; the service then checks the',
    'quote with `assertCan`, and Postgres RLS enforces the data scope as the second layer.',
    '',
    '| Method | Route | Permission | Passes the gate | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...sorted.map((r) => {
      const notes = [r.requires ? `also requires \`${r.requires}\`` : '', r.reason ?? '']
        .filter(Boolean)
        .join('; ');
      return `| ${r.method} | \`${r.route}\` | \`${r.permission}\` | ${cell(gateHolders(r))} | ${cell(notes)} |`;
    }),
    '',
    '## Permissions checked in services',
    '',
    'These matrix permissions are not a route gate; the service checks them against the resource.',
    '',
    '| Permission | Holders | Where, and the test that proves it |',
    '| --- | --- | --- |',
    ...(Object.entries(SERVICE_CHECKED_PERMISSIONS) as [Permission, string][]).map(
      ([p, where]) =>
        `| \`${p}\` | ${cell(
          (Object.entries(PERMISSION_MATRIX[p]) as [Role, Grant][])
            .map(([role, g]) => describeGrant(role, g))
            .join(', '),
        )} | ${cell(where)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
