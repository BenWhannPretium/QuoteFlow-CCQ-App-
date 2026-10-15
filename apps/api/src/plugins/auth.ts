import { DEV_USER_HEADER } from '@ccq/contracts';
import {
  asUserId,
  assertHoldsPermission,
  PERMISSIONS,
  type Actor,
  type Permission,
} from '@ccq/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AppConfig } from '../config';
import { problem, sendProblem } from './problem-json';
import { devIdentity } from '../auth/dev';
import type { IdentityService, ProvisionedUser } from '../auth/directory';
import type { EntraVerifier } from '../auth/entra';
import { AuthError, assertHasRole, type Identity } from '../auth/identity';

/** A route's permission: a matrix permission, or any signed-in user with a CCQ role. */
export type RoutePermission = Permission | 'authenticated';

export interface CurrentUser extends ProvisionedUser {
  /** AUTH_MODE=dev persona key. */
  devPersona?: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Required on every /api route unless `public: true`. Checked before the handler runs. */
    permission?: RoutePermission;
    /** No authentication at all (health, auth config). */
    public?: boolean;
  }
  interface FastifyInstance {
    /** Every /api route and its declaration (for the permission-matrix coverage test). */
    apiRoutes: readonly ApiRouteDeclaration[];
  }
  interface FastifyRequest {
    /** Set on every authenticated request; null on public routes. Use `requireActor(req)`. */
    actor: Actor | null;
    currentUser: CurrentUser | null;
  }
}

export interface ApiRouteDeclaration {
  method: string;
  url: string;
  permission: RoutePermission | 'public';
}

const isApiRoute = (url: string) => url === '/api' || url.startsWith('/api/');

/** Why a route's declaration is invalid, or null if it is fine. Exported for tests. */
export function routeDeclarationProblem(
  url: string,
  config: { permission?: unknown; public?: unknown } | undefined,
): string | null {
  if (!isApiRoute(url)) return null; // swagger UI and the SPA: no data, served by plugins
  const permission = config?.permission;
  const isPublic = config?.public === true;
  if (isPublic && permission !== undefined) return 'declares both public and a permission';
  if (isPublic) return null;
  if (permission === undefined) return 'declares neither a permission nor public: true';
  if (permission !== 'authenticated' && !(PERMISSIONS as readonly unknown[]).includes(permission)) {
    return `declares unknown permission ${JSON.stringify(permission)}`;
  }
  return null;
}

export interface AuthPluginOptions {
  config: AppConfig;
  identity: IdentityService;
  /** Required when AUTH_MODE=entra. */
  verifyToken?: EntraVerifier;
}

function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match?.[1]) throw new AuthError('missing_token', 401, 'Sign in required (no bearer token)');
  return match[1];
}

/**
 * Authentication (Entra JWT or dev persona), user provisioning, `req.actor`, and the route-level
 * permission check. Boot fails if any /api route lacks a permission declaration.
 */
export const authPlugin = fp(
  (app: FastifyInstance, opts: AuthPluginOptions) => {
    const { config, identity } = opts;

    let authenticate: (req: FastifyRequest) => Promise<Identity>;
    if (config.AUTH_MODE === 'dev') {
      authenticate = (req) => {
        const raw = req.headers[DEV_USER_HEADER];
        return Promise.resolve(assertHasRole(devIdentity(Array.isArray(raw) ? raw[0] : raw)));
      };
    } else {
      const verify = opts.verifyToken;
      if (!verify) throw new Error('authPlugin: verifyToken is required when AUTH_MODE=entra');
      authenticate = (req) => verify(bearerToken(req));
    }

    app.decorateRequest('actor', null);
    app.decorateRequest('currentUser', null);

    const undeclared: string[] = [];
    const apiRoutes: ApiRouteDeclaration[] = [];
    app.decorate('apiRoutes', apiRoutes);
    app.addHook('onRoute', (route) => {
      const why = routeDeclarationProblem(route.url, route.config);
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      if (why) undeclared.push(`${methods.join(',')} ${route.url} ${why}`);
      else if (isApiRoute(route.url)) {
        for (const method of methods) {
          if (method === 'HEAD') continue; // auto-generated for GET
          apiRoutes.push({
            method,
            url: route.url,
            permission: route.config?.public ? 'public' : route.config!.permission!,
          });
        }
      }
    });
    app.addHook('onReady', async () => {
      if (undeclared.length > 0) {
        throw new Error(
          `Every /api route must declare config.permission or config.public:\n  ${undeclared.join('\n  ')}`,
        );
      }
    });

    app.addHook('onRequest', async (req, reply) => {
      const routeConfig = req.routeOptions.config;
      // 404s (no matched route), public routes and non-API plugin routes need no identity.
      if (!req.routeOptions.url || routeConfig.public || !routeConfig.permission) return;

      let user: ProvisionedUser;
      let personaKey: string | undefined;
      try {
        const who = await authenticate(req);
        personaKey = who.dev?.personaKey;
        user = await identity.resolve(who, {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          requestId: req.id,
        });
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        if (err.status === 401) {
          void reply.header(
            'www-authenticate',
            `Bearer realm="QuoteFlow", error="${err.reason === 'missing_token' ? 'invalid_request' : 'invalid_token'}"`,
          );
        }
        return sendProblem(
          reply,
          problem(err.status, req, {
            title: err.status === 401 ? 'Unauthorized' : 'Forbidden',
            detail: err.message,
            code: err.reason,
          }),
        );
      }

      req.actor = { userId: asUserId(user.userId), roles: user.roles, scope: user.scope };
      req.currentUser = personaKey ? { ...user, devPersona: personaKey } : user;

      // Route-level: does any role hold the permission? Resource checks (own / assigned / scope)
      // happen in services with assertCan(actor, permission, resource).
      if (routeConfig.permission !== 'authenticated') {
        assertHoldsPermission(req.actor, routeConfig.permission);
      }
    });
  },
  { name: 'auth', dependencies: ['problem-json'] },
);

/** The authenticated actor. Throws if called on a public route (a programming error). */
export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw new Error('requireActor: route is public or auth did not run');
  return req.actor;
}
