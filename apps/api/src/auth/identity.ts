import { isRole, type Role, type Scope } from '@ccq/domain';

/**
 * Prefix on the prod QuoteFlow Entra app roles (`CCQ.KAM` → `KAM`). Test honours `CCQ.Test.` instead
 * (ENTRA_ROLE_PREFIX): both environments share one app registration.
 */
export const CCQ_ROLE_PREFIX = 'CCQ.';

/** Who the caller is, as asserted by the token (or the dev persona). Not yet provisioned. */
export interface Identity {
  /** Entra object id (`oid`). The stable user key. */
  oid: string;
  /** `preferred_username` (UPN). */
  upn: string;
  /** `name` claim. */
  displayName: string;
  email: string | null;
  /** CCQ app roles from the token, prefix stripped, unknown values dropped. */
  roles: Role[];
  /** Set for AUTH_MODE=dev personas. */
  dev?: { personaKey: string; scope: Scope };
}

/**
 * Map the token `roles` claim to CCQ roles. Roles without `prefix`, and unknown roles, are ignored, so
 * with `CCQ.` a `CCQ.Test.Admin` is dropped (`Test.Admin` is not a role), and with `CCQ.Test.` a
 * `CCQ.Admin` is.
 */
export function rolesFromClaim(claim: unknown, prefix: string = CCQ_ROLE_PREFIX): Role[] {
  if (!Array.isArray(claim)) return [];
  const roles = new Set<Role>();
  for (const value of claim) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) continue;
    const role = value.slice(prefix.length);
    if (isRole(role)) roles.add(role);
  }
  return [...roles].sort();
}

export type AuthFailure = 'missing_token' | 'invalid_token' | 'no_role' | 'unknown_persona';

/** Authentication failed. 401 for a missing/invalid credential, 403 for a valid user with no CCQ role. */
export class AuthError extends Error {
  constructor(
    readonly reason: AuthFailure,
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const NO_ROLE_MESSAGE = 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group';

export function assertHasRole(identity: Identity): Identity {
  if (identity.roles.length === 0) throw new AuthError('no_role', 403, NO_ROLE_MESSAGE);
  return identity;
}
