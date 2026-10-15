import { DEV_USER_HEADER } from '@ccq/contracts';
import { PERSONA_DEFS } from '@ccq/db/personas';
import type { Role, Scope } from '@ccq/domain';
import type { FastifyInstance, HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';

/** The dev persona with exactly `role` and the given scope type (default `all`). */
export function personaFor(role: Role, scope: Scope['type'] = 'all'): string {
  const persona = PERSONA_DEFS.find(
    (p) => p.roles.length === 1 && p.roles[0] === role && p.scope.type === scope,
  );
  if (!persona) throw new Error(`No dev persona with role ${role} and scope ${scope}`);
  return persona.key;
}

/** Issue dev-mode requests as a single-role persona: `asRole(app, 'KAM', 'owner').get('/api/v1/me')`. */
export function asRole(app: FastifyInstance, role: Role, scope?: Scope['type']) {
  const persona = personaFor(role, scope);
  const send = (
    method: HTTPMethods,
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> => {
    const opts: InjectOptions = { method, url, headers: { [DEV_USER_HEADER]: persona } };
    if (payload !== undefined) opts.payload = payload as NonNullable<InjectOptions['payload']>;
    return app.inject(opts);
  };
  return {
    persona,
    request: send,
    get: (url: string) => send('GET', url),
    post: (url: string, body?: unknown) => send('POST', url, body),
    put: (url: string, body?: unknown) => send('PUT', url, body),
    patch: (url: string, body?: unknown) => send('PATCH', url, body),
    delete: (url: string) => send('DELETE', url),
  };
}

/** Anonymous request (no persona header). */
export const anonymous = (
  app: FastifyInstance,
  method: HTTPMethods,
  url: string,
): Promise<LightMyRequestResponse> => app.inject({ method, url });
