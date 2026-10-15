import { HealthResponse } from '@ccq/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AppDeps } from '../../app';

export const healthRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; version: string }> = async (
  app,
  { deps, version },
) => {
  app.get(
    '/health',
    {
      // Liveness/readiness probe: public, and exempt from rate limiting so probes never 429.
      // TODO(B-04): every other route declares a permission; health stays anonymous.
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Service health with database status',
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (_request, reply) => {
      const dbUp = await deps.db.ping();
      const body: HealthResponse = {
        status: dbUp ? 'ok' : 'degraded',
        version,
        db: dbUp ? 'up' : 'down',
        time: new Date().toISOString(),
      };
      return reply.status(dbUp ? 200 : 503).send(body);
    },
  );
};
