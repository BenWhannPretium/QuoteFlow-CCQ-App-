import { z } from 'zod';

export const AuthMode = z.enum(['entra', 'dev']);
export type AuthMode = z.infer<typeof AuthMode>;

/** Data scope (architecture §3.2), mirrors `user_scope`. */
export const ScopeDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('owner') }),
  z.object({ type: z.literal('region'), values: z.array(z.string()) }),
  z.object({ type: z.literal('account_list'), values: z.array(z.string()) }),
]);
export type ScopeDto = z.infer<typeof ScopeDto>;

/** A dev-mode persona (AUTH_MODE=dev only): sent as the `x-dev-user` header. */
export const DevPersona = z.object({
  key: z.string(),
  roles: z.array(z.string()),
  scope: ScopeDto,
});
export type DevPersona = z.infer<typeof DevPersona>;

/**
 * `GET /api/v1/auth/config` (public): what the SPA needs to start sign-in. Served at runtime so one
 * web build works in every environment. None of these values are secrets.
 */
export const AuthConfigResponse = z.discriminatedUnion('authMode', [
  z.object({
    authMode: z.literal('entra'),
    tenantId: z.string(),
    spaClientId: z.string(),
    /** e.g. `api://<api-client-id>/access_as_user` */
    apiScope: z.string(),
  }),
  z.object({
    authMode: z.literal('dev'),
    personas: z.array(DevPersona),
  }),
]);
export type AuthConfigResponse = z.infer<typeof AuthConfigResponse>;

/** `GET /api/v1/me`: the signed-in user, effective roles, permissions, scope and feature flags. */
export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string(),
    upn: z.string(),
    email: z.string().nullable(),
  }),
  /** App roles without the `CCQ.` prefix (KAM, Pricing, …). */
  roles: z.array(z.string()),
  /** Permissions held by any role, qualified grants included; services still check each resource. */
  permissions: z.array(z.string()),
  scope: ScopeDto,
  /** Boolean app settings the UI may branch on (e.g. g1Enabled). Never the control. */
  featureFlags: z.record(z.string(), z.boolean()),
  authMode: AuthMode,
  /** The persona key when authMode is dev. */
  devPersona: z.string().optional(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** Request header carrying the dev persona key (AUTH_MODE=dev only). */
export const DEV_USER_HEADER = 'x-dev-user';
