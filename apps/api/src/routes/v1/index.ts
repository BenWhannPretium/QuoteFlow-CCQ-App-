import type { FastifyPluginAsync } from 'fastify';

import { adminRoutes } from './admin';
import { authConfigRoutes } from './auth-config';
import { configRoutes } from './config';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import { salesforceRoutes } from './salesforce';
import type { AppDeps } from '../../app';
import type { IdentityService } from '../../auth/directory';
import type { AppConfig } from '../../config';
import type { SfSyncScheduler } from '../../jobs/sfSync';
import type { SalesforceService } from '../../services/salesforce';

export interface V1Options {
  deps: AppDeps;
  version: string;
  config: AppConfig;
  identity: IdentityService;
  sfService: SalesforceService;
  sfSync: SfSyncScheduler | null;
}

/**
 * Every route declares `config.permission` (or `config.public: true`); boot fails otherwise.
 * Add each new route to apps/api/test/permissions/registry.ts so the permission matrix covers it.
 */
export const v1Routes: FastifyPluginAsync<V1Options> = async (
  app,
  { deps, version, config, identity, sfService, sfSync },
) => {
  // Pass only our options: forwarding `opts` would re-apply the parent's `prefix`.
  await app.register(healthRoutes, { deps, version });
  await app.register(authConfigRoutes, { config });
  await app.register(meRoutes, { config, identity });
  await app.register(configRoutes, deps.now ? { now: deps.now } : {});
  await app.register(salesforceRoutes, { service: sfService });
  await app.register(adminRoutes, { sfSync });
  // TODO(B-07+): quotes, intake, queue, gates, overrides, attachments, lookups, dashboards.
};
