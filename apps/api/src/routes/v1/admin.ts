import {
  ErfLinkageResponse,
  IntegrationRunsQuery,
  IntegrationRunsResponse,
  SfSyncTriggerResponse,
  type IntegrationRun,
} from '@ccq/contracts';
import { listIntegrationRuns } from '@ccq/db/repos';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { SfSyncResult, SfSyncScheduler } from '../../jobs/sfSync';
import { problem, sendProblem } from '../../plugins/problem-json';
import { erfLinkageReport } from '../../services/salesforce';

/** How long POST /admin/salesforce/sync waits before answering 202 (the run continues). */
export const SYNC_WAIT_MS = 25_000;

/** Admin: integrations and reports. Reading the runs is config.read (Leadership too, B-19); acting is config.manage. */
export const adminRoutes: FastifyPluginAsyncZod<{ sfSync: SfSyncScheduler | null }> = async (
  app,
  { sfSync },
) => {
  app.post(
    '/admin/salesforce/sync',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags: ['admin'],
        summary:
          'Run the Salesforce delta sync now. 200 with the result, or 202 if it is still running after 25 s',
        security: [{ bearerAuth: [] }],
        response: { 200: SfSyncTriggerResponse, 202: SfSyncTriggerResponse },
      },
    },
    async (req, reply) => {
      if (!sfSync) {
        return sendProblem(
          reply,
          problem(503, req, { detail: 'Salesforce sync is not configured', code: 'unavailable' }),
        );
      }
      let timer: NodeJS.Timeout | undefined;
      const waited = await Promise.race([
        sfSync.runNow(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SYNC_WAIT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      if (!waited) {
        return reply.status(202).send({ outcome: 'running', runId: null, counts: {} });
      }
      const result: SfSyncResult = waited;
      return { outcome: result.outcome, runId: result.runId, counts: { ...result.counts } };
    },
  );

  app.get(
    '/admin/integrations',
    {
      config: { permission: 'config.read' },
      schema: {
        tags: ['admin'],
        summary: 'Recent integration runs (Salesforce sync, pricing, SharePoint), newest first',
        security: [{ bearerAuth: [] }],
        querystring: IntegrationRunsQuery,
        response: { 200: IntegrationRunsResponse },
      },
    },
    async (req) => {
      const rows = await app.withTx(req, (tx) =>
        listIntegrationRuns(tx, { source: req.query.source, limit: req.query.limit }),
      );
      const items: IntegrationRun[] = rows.map((r) => ({
        id: r.id,
        source: r.source,
        status: r.status as IntegrationRun['status'],
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        counts: r.counts as Record<string, number>,
        error: r.error,
      }));
      return { items };
    },
  );

  app.get(
    '/admin/reports/erf-linkage',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags: ['admin', 'reports'],
        summary:
          'CCQ quotes with their SF opportunity, SF ERF number and CCQ erf_number, flagging mismatches',
        security: [{ bearerAuth: [] }],
        response: { 200: ErfLinkageResponse },
      },
    },
    async (req) => app.withTx(req, (tx) => erfLinkageReport(tx)),
  );
};
