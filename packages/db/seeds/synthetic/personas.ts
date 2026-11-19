import type { Role, Scope } from '@ccq/domain';

import { createRng, DEFAULT_SEED, type Rng } from './rng';

/**
 * The synthetic users. B-04's dev-mode persona switcher (`x-dev-user: <key>`) uses these keys:
 * one per role, a multi-role user, an owner-scoped KAM, a region-scoped KAM and an owner-scoped Engineer.
 * Names come from faker with a fixed seed; emails use the reserved example.com domain.
 * B-26 added the pricing lead (13th), FB-07 Finance (14th), FB-16 the production scheduler (15th). FB-22
 * added an engineering lead who is also an engineer (16th), not seeded.
 * Personas after the first 12 draw their names and ids from their own seeded stream, so every row
 * generated before B-26 stays identical.
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
  { key: 'pricing-lead', roles: ['PricingLead'], scope: { type: 'all' }, region: null },
  // FB-07 (F-083): Finance (Stacy Slocum's role) reads quotes and uploads the ROI model.
  { key: 'finance', roles: ['Finance'], scope: { type: 'all' }, region: null },
  // FB-16 (W13-15, D-008 open, provisional): the Production Scheduler works the capacity part of the
  // quotes the engineering lead assigns them.
  {
    key: 'production-scheduler',
    roles: ['ProductionScheduler'],
    scope: { type: 'all' },
    region: null,
  },
  // FB-22 (D2, Ben 2026-11-18): an engineering lead who also works as an engineer (as Jim Zweifel does), so
  // "a lead approves their own work" can be tried and tested. Not seeded (see UNSEEDED_PERSONAS): the
  // user is made the first time someone signs in as it, so the seeded data and every count stay as they were.
  {
    key: 'eng-lead-engineer',
    roles: ['EngLead', 'Engineer'],
    scope: { type: 'all' },
    region: null,
  },
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

/** How many personas existed before B-26 (they keep drawing from the main stream). */
export const ORIGINAL_PERSONAS = 12;

/** Dev personas the synthetic seed does not insert (the dev sign-in makes the user on first use). */
export const UNSEEDED_PERSONAS: ReadonlySet<string> = new Set(['eng-lead-engineer']);

export function buildPersonas(main: Rng, anchor: Date): Persona[] {
  const created = new Date(anchor.getTime() - 400 * 86_400_000);
  const later = createRng(DEFAULT_SEED + 26);
  return PERSONA_DEFS.flatMap((def, i): Persona[] => {
    if (UNSEEDED_PERSONAS.has(def.key)) return [];
    const rng = i < ORIGINAL_PERSONAS ? main : later;
    const first = rng.faker.person.firstName();
    const last = rng.faker.person.lastName();
    const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com';
    return [
      {
        key: def.key,
        id: rng.uuid(new Date(created.getTime() + i)),
        entraOid: personaOid(i),
        upn: email,
        displayName: `${first} ${last}`,
        email,
        region: def.region,
        roles: def.roles,
        scope: def.scope,
      },
    ];
  });
}
