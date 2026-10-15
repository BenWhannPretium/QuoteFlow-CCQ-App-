import type { DevPersona } from '@ccq/contracts';
import { PERSONA_DEFS, personaOid } from '@ccq/db/personas';

import { AuthError, type Identity } from './identity';

/**
 * AUTH_MODE=dev only. Personas are the synthetic seed users (`packages/db/seeds/synthetic/personas.ts`):
 * one per role, a multi-role user, owner- and region-scoped KAMs and an owner-scoped Engineer.
 * config.ts refuses to boot with AUTH_MODE=dev in production.
 */
export const devPersonas = (): DevPersona[] =>
  PERSONA_DEFS.map((p) => ({
    key: p.key,
    roles: [...p.roles],
    scope: p.scope.type === 'region' ? { type: 'region', values: [...p.scope.values] } : p.scope,
  }));

export function devIdentity(personaKey: string | undefined): Identity {
  if (!personaKey) {
    throw new AuthError('missing_token', 401, 'AUTH_MODE=dev: send the x-dev-user header');
  }
  const index = PERSONA_DEFS.findIndex((p) => p.key === personaKey);
  const def = PERSONA_DEFS[index];
  if (!def) {
    throw new AuthError('unknown_persona', 401, `AUTH_MODE=dev: unknown persona "${personaKey}"`);
  }
  return {
    oid: personaOid(index),
    // Placeholder profile: a seeded database keeps its own (faker) names for these oids.
    upn: `${def.key}@dev.example.com`,
    displayName: `Dev ${def.key}`,
    email: `${def.key}@dev.example.com`,
    roles: [...def.roles],
    dev: { personaKey: def.key, scope: def.scope },
  };
}
