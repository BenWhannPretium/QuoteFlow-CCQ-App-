import type { FastifyPluginAsync } from 'fastify';

import { adminRoutes } from './admin';
import { authConfigRoutes } from './auth-config';
import { configRoutes } from './config';
import { gateRoutes } from './gates';
import { healthRoutes } from './health';
import { intakeRoutes } from './intake';
import { meRoutes } from './me';
import { salesforceRoutes } from './salesforce';
import type { AppDeps } from '../../app';
import type { IdentityService } from '../../auth/directory';
import type { AppConfig } from '../../config';
import type { SfSyncScheduler } from '../../jobs/sfSync';
import type { GateService } from '../../services/gateService';
import type { IntakeService } from '../../services/intake';
import type { SalesforceService } from '../../services/salesforce';

export interface V1Options {
  deps: AppDeps;
  version: string;
  config: AppConfig;
  identity: IdentityService;
  sfService: SalesforceService;
  sfSync: SfSyncScheduler | null;
  intakeService: IntakeService;
  gateService: GateService;
}

/**
 * Every route declares `config.permission` (or `config.public: true`); boot fails otherwise.
 * Add each new route to apps/api/test/permissions/registry.ts so the permission matrix covers it.
 */
export const v1Routes: FastifyPluginAsync<V1Options> = async (
  app,
  { deps, version, config, identity, sfService, sfSync, intakeService, gateService },
) => {
  // Pass only our options: forwarding `opts` would re-apply the parent's `prefix`.
  await app.register(healthRoutes, { deps, version });
  await app.register(authConfigRoutes, { config });
  await app.register(meRoutes, { config, identity });
  await app.register(configRoutes, deps.now ? { now: deps.now } : {});
  await app.register(salesforceRoutes, { service: sfService });
  await app.register(adminRoutes, { sfSync });
  await app.register(intakeRoutes, { service: intakeService });
  await app.register(gateRoutes, { service: gateService });
  // TODO(B-09+): overrides, attachments, lookups, dashboards.
};
