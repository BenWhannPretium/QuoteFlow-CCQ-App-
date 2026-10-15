import type { Role, Scope } from '@ccq/domain';

import type { Rng } from './rng';

/**
 * The 12 synthetic users. B-04's dev-mode persona switcher (`x-dev-user: <key>`) uses these keys:
 * one per role, a multi-role user, an owner-scoped KAM, a region-scoped KAM and an owner-scoped Engineer.
 * Names come from faker with a fixed seed; emails use the reserved example.com domain.
 */
export const PERSONA_DEFS = [
  { key: 'kam', roles: ['KAM'], scope: { type: 'all' }, region: 'Central' },
  { key: 'kam-owner', roles: ['KAM'], scope: { type: 'owner' }, region: 'East' },
  {
    key: 'kam-region',
    roles: ['KAM'],
    scope: { type: 'region', values: ['West'] },
    region: 'West',
  },
  { key: 'sales-leader', roles: ['SalesLeader'], scope: { type: 'all' }, region: 'Central' },
  { key: 'eng-lead', roles: ['EngLead'], scope: { type: 'all' }, region: null },
  { key: 'engineer', roles: ['Engineer'], scope: { type: 'all' }, region: null },
  { key: 'engineer-owner', roles: ['Engineer'], scope: { type: 'owner' }, region: null },
  { key: 'pricing', roles: ['Pricing'], scope: { type: 'all' }, region: null },
  { key: 'approver', roles: ['Approver'], scope: { type: 'all' }, region: null },
  { key: 'leadership', roles: ['Leadership'], scope: { type: 'all' }, region: null },
  { key: 'admin', roles: ['Admin'], scope: { type: 'all' }, region: null },
  { key: 'multi-role', roles: ['SalesLeader', 'Approver'], scope: { type: 'all' }, region: 'East' },
] as const satisfies readonly {
  key: string;
  roles: readonly Role[];
  scope: Scope;
  region: string | null;
}[];

export type PersonaKey = (typeof PERSONA_DEFS)[number]['key'];

export interface Persona {
  key: PersonaKey;
  id: string;
  entraOid: string;
  upn: string;
  displayName: string;
  email: string;
  region: string | null;
  roles: readonly Role[];
  scope: Scope;
}

/** Entra object ids for dev personas: fixed and obviously fake (00000000-0000-4000-8000-0000000000NN). */
export const personaOid = (index: number) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function buildPersonas(rng: Rng, anchor: Date): Persona[] {
  const created = new Date(anchor.getTime() - 400 * 86_400_000);
  return PERSONA_DEFS.map((def, i) => {
    const first = rng.faker.person.firstName();
    const last = rng.faker.person.lastName();
    const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com';
    return {
      key: def.key,
      id: rng.uuid(new Date(created.getTime() + i)),
      entraOid: personaOid(i),
      upn: email,
      displayName: `${first} ${last}`,
      email,
      region: def.region,
      roles: def.roles,
      scope: def.scope,
    };
  });
}
