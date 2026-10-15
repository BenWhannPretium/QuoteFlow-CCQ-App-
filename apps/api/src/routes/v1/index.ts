import type { FastifyPluginAsync } from 'fastify';

import { authConfigRoutes } from './auth-config';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import type { AppDeps } from '../../app';
import type { IdentityService } from '../../auth/directory';
import type { AppConfig } from '../../config';

export interface V1Options {
  deps: AppDeps;
  version: string;
  config: AppConfig;
  identity: IdentityService;
}

/**
 * Every route declares `config.permission` (or `config.public: true`); boot fails otherwise.
 * Add each new route to apps/api/test/permissions/registry.ts so the permission matrix covers it.
 */
export const v1Routes: FastifyPluginAsync<V1Options> = async (
  app,
  { deps, version, config, identity },
) => {
  // Pass only our options: forwarding `opts` would re-apply the parent's `prefix`.
  await app.register(healthRoutes, { deps, version });
  await app.register(authConfigRoutes, { config });
  await app.register(meRoutes, { config, identity });
  // TODO(B-06+): quotes, intake, queue, gates, overrides, attachments, lookups, dashboards, admin.
};
