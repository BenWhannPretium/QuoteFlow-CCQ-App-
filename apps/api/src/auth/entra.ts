import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { AuthError, assertHasRole, rolesFromClaim, type Identity } from './identity';

export interface EntraVerifierOptions {
  tenantId: string;
  /** Accepted `aud` values: the App ID URI (api://…) and, for v2 tokens, the API client id. */
  audiences: string[];
  /** Delegated scope that must appear in `scp`. */
  requiredScope: string;
  /** Seconds of clock skew allowed on exp/nbf. */
  clockToleranceSeconds?: number;
  /** Signing keys. Defaults to the tenant's JWKS; tests pass a local key set. */
  keySet?: JWTVerifyGetKey;
}

export const entraIssuer = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/v2.0`;
export const entraJwksUrl = (tenantId: string) =>
  new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function identityFromPayload(payload: JWTPayload, requiredScope: string): Identity {
  const scopes = (str(payload.scp) ?? '').split(' ');
  if (!scopes.includes(requiredScope)) {
    throw new AuthError('invalid_token', 401, `Token is missing the ${requiredScope} scope`);
  }
  const oid = str(payload.oid);
  if (!oid) throw new AuthError('invalid_token', 401, 'Token has no oid claim');
  const upn = str(payload.preferred_username) ?? str(payload.upn) ?? oid;
  const email = str(payload.email) ?? (upn.includes('@') ? upn : null);
  return assertHasRole({
    oid,
    upn,
    displayName: str(payload.name) ?? upn,
    email,
    roles: rolesFromClaim(payload.roles),
  });
}

/**
 * Validates an Entra v2 access token for the QuoteFlow API: signature (tenant JWKS), issuer,
 * audience, exp/nbf (60 s tolerance) and the `access_as_user` scope. Returns the caller's identity;
 * throws AuthError (401 invalid, 403 no CCQ role).
 */
export function createEntraVerifier(opts: EntraVerifierOptions) {
  const keySet = opts.keySet ?? createRemoteJWKSet(entraJwksUrl(opts.tenantId));
  const issuer = entraIssuer(opts.tenantId);

  return async function verify(token: string): Promise<Identity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience: opts.audiences,
        algorithms: ['RS256'],
        clockTolerance: opts.clockToleranceSeconds ?? 60,
        requiredClaims: ['exp', 'oid'],
      }));
    } catch (err) {
      const detail =
        err instanceof errors.JWTExpired
          ? 'Token has expired'
          : err instanceof errors.JWTClaimValidationFailed
            ? `Token ${err.claim} claim is invalid`
            : 'Token is invalid';
      throw new AuthError('invalid_token', 401, detail);
    }
    return identityFromPayload(payload, opts.requiredScope);
  };
}

export type EntraVerifier = ReturnType<typeof createEntraVerifier>;
