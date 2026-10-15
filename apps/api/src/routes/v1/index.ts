import type { FastifyPluginAsync } from 'fastify';

import { healthRoutes } from './health';
import type { AppDeps } from '../../app';

export const v1Routes: FastifyPluginAsync<{ deps: AppDeps; version: string }> = async (
  app,
  { deps, version },
) => {
  // Pass only our options: forwarding `opts` would re-apply the parent's `prefix`.
  await app.register(healthRoutes, { deps, version });
  // TODO(B-04+): me, quotes, intake, queue, gates, overrides, attachments, lookups, dashboards, admin.
};
