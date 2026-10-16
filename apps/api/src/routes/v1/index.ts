import type { FastifyPluginAsync } from 'fastify';

import { adminRoutes } from './admin';
import { auditRoutes } from './audit';
import { authConfigRoutes } from './auth-config';
import { configRoutes } from './config';
import { engineeringRoutes } from './engineering';
import { finalReviewRoutes } from './final-review';
import { gateRoutes } from './gates';
import { healthRoutes } from './health';
import { intakeRoutes } from './intake';
import { meRoutes } from './me';
import { outcomeRoutes } from './outcome';
import { overrideRoutes } from './overrides';
import { pipelineRoutes } from './pipeline';
import { pricingRoutes } from './pricing';
import { salesforceRoutes } from './salesforce';
import { timelineRoutes } from './timeline';
import type { AppDeps } from '../../app';
import type { IdentityService } from '../../auth/directory';
import type { AppConfig } from '../../config';
import type { SfSyncScheduler } from '../../jobs/sfSync';
import type { AuditAdminService } from '../../services/auditAdmin';
import type { EngineeringService } from '../../services/engineering';
import type { FinalReviewService } from '../../services/final-review';
import type { GateService } from '../../services/gateService';
import type { IntakeService } from '../../services/intake';
import type { OutcomeService } from '../../services/outcome';
import type { OverrideService } from '../../services/overrideService';
import type { PipelineService } from '../../services/pipeline';
import type { PricingService } from '../../services/pricing';
import type { SalesforceService } from '../../services/salesforce';
import type { TimelineService } from '../../services/timeline';

export interface V1Options {
  deps: AppDeps;
  version: string;
  config: AppConfig;
  identity: IdentityService;
  sfService: SalesforceService;
  sfSync: SfSyncScheduler | null;
  intakeService: IntakeService;
  gateService: GateService;
  overrideService: OverrideService;
  timelineService: TimelineService;
  auditService: AuditAdminService;
  engineeringService: EngineeringService;
  pricingService: PricingService;
  finalReviewService: FinalReviewService;
  outcomeService: OutcomeService;
  pipelineService: PipelineService;
}

/**
 * Every route declares `config.permission` (or `config.public: true`); boot fails otherwise.
 * Add each new route to apps/api/test/permissions/registry.ts so the permission matrix covers it.
 */
export const v1Routes: FastifyPluginAsync<V1Options> = async (
  app,
  {
    deps,
    version,
    config,
    identity,
    sfService,
    sfSync,
    intakeService,
    gateService,
    overrideService,
    timelineService,
    auditService,
    engineeringService,
    pricingService,
    finalReviewService,
    outcomeService,
    pipelineService,
  },
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
  await app.register(overrideRoutes, { service: overrideService });
  await app.register(timelineRoutes, { service: timelineService });
  await app.register(auditRoutes, { service: auditService });
  await app.register(engineeringRoutes, { service: engineeringService });
  await app.register(pricingRoutes, { service: pricingService });
  await app.register(finalReviewRoutes, { service: finalReviewService });
  await app.register(outcomeRoutes, { service: outcomeService });
  await app.register(pipelineRoutes, { service: pipelineService });
  // TODO(B-15+): attachments, lookups, dashboards.
};
