# B-04 · Authentication (Entra ID) and server-side RBAC (F-01, F-09)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `docs/build-guide/01-architecture.md` §3 and §7. Implement sign-in, token validation, user provisioning, permission enforcement and the request context.

## Inputs you need (from IT at M2; use placeholders in `.env.example` until then)
`ENTRA_TENANT_ID`, `ENTRA_SPA_CLIENT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_AUDIENCE` (`api://<api-client-id>`) and the API scope `access_as_user`. App roles:
- `CCQ.KAM`
- `CCQ.SalesLeader`
- `CCQ.EngLead`
- `CCQ.Engineer`
- `CCQ.Pricing`
- `CCQ.Approver`
- `CCQ.Leadership`
- `CCQ.Admin`

## API (`apps/api/src/plugins/auth.ts`, `requestContext.ts`)

### 1. Token validation (`AUTH_MODE=entra`)
- Validate the bearer JWT with `jose` and `createRemoteJWKSet('https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys')`.
- Check issuer `https://login.microsoftonline.com/{tenant}/v2.0`, audience `ENTRA_API_AUDIENCE`, `exp`/`nbf` with 60 s clock tolerance, and the `scp` claim includes `access_as_user`.
- Extract `oid`, `preferred_username`, `name` and `roles`.
- Reject tokens with no CCQ role (403 problem+json, "No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group").

### 2. Dev mode (`AUTH_MODE=dev`, never in production)
- Accept header `x-dev-user: <persona-key>`.
- Personas come from the synthetic seed users (one per role, plus a multi-role user and an owner-scoped KAM).
- Log a loud warning at boot.

### 3. User provisioning
- On every authenticated request, upsert `app_user` by `entra_oid` (cache for 5 minutes) and sync `user_role` from the token's roles. The token is the source of truth: remove roles that are no longer present.
- Load `user_scope`. Default to `all` for every role, per the PRD lean of full pipeline visibility. This is setting-backed.

### 4. Request context
- Attach `req.actor = { userId, roles, scope }`.
- Provide `withTx(req, fn)`, which opens a transaction and runs `SET LOCAL app.user_id/app.roles/app.scope_*` (from B-03's helper), so RLS applies to every query.

### 5. Authorization
- Route option `config: { permission: 'quote.read' }`. A preHandler calls `domain.policy.assertCan`; resource-level checks happen in services.
- **Every route must declare a permission or `public: true`.** Add a startup check that fails boot if any route lacks one.

### 6. `GET /api/v1/me`
Returns `{ user, roles, permissions[], scope, featureFlags }`.

### 7. Sign-in audit
`audit_event` with `action='sign_in'` once per session (first request per 8 h per user).

## Web (`apps/web/src/auth/`)
1. Set up `@azure/msal-browser` + `@azure/msal-react`: auth code + PKCE, redirect flow (works on mobile Safari) and `sessionStorage` cache. Acquire tokens silently for scope `api://…/access_as_user`, with an interactive fallback.
2. `<AuthGate>` wraps the app: unauthenticated users get a branded sign-in page; signed-in users load `/me` into the TanStack Query cache.
3. `useCurrentUser()`, `useCan(permission)`, `<RequirePermission permission=…>`.
4. In dev mode, show a persona switcher in the header (only when `/me` reports `authMode=dev`).
5. The API client attaches the bearer token and handles 401 (re-acquire once) and 403 (friendly page).

## Permission-matrix test harness (`apps/api/test/permissions/`)
- A helper `asRole(role, scope?)` issues dev-mode requests.
- A route registry exports `[{ method, url, permission, sampleBody }]`, and a generated test asserts **allowed roles get non-403 and every other role gets 403** for every registered route.
- Add the routes that exist so far (`/me`, `/health`). Later steps add theirs.

## Acceptance
- [ ] With real Entra config, signing in works locally and in test. With dev mode, the persona switcher works.
- [ ] Expired, wrong-audience and no-role tokens are rejected (unit-test the plugin with locally signed test JWTs from a test JWKS)
- [ ] Boot fails if a route lacks a permission declaration
- [ ] Permission-matrix test runs in CI
- [ ] Tick B-04 in `docs/build-guide/03-build-steps.md`

**Note for Ben:** if IT hasn't created the app registrations by Oct 20, ship with dev mode and the Entra code path fully unit-tested; flip the config when M2 delivers.
