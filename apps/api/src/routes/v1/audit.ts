import {
  AuditExportQuery,
  AuditListResponse,
  AuditQuery,
  UsageReportQuery,
  UsageReportResponse,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { AuditAdminService, AuditWithTx } from '../../services/auditAdmin';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/** The usage audit viewer, its CSV export and the adoption report (F-12; audit.read = Leadership + Admin). */
export const auditRoutes: FastifyPluginAsyncZod<{ service: AuditAdminService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): AuditWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/admin/audit',
    {
      config: { permission: 'audit.read' },
      schema: {
        tags: ['admin', 'audit'],
        summary:
          'Search the append-only usage audit log by user, quote, action and date (US Central days), newest first',
        security,
        querystring: AuditQuery,
        response: { 200: AuditListResponse },
      },
    },
    async (req, reply) => handleProblems(req, reply, () => service.list(withTx(req), req.query)),
  );

  app.get(
    '/admin/audit/export.csv',
    {
      config: { permission: 'audit.read' },
      schema: {
        tags: ['admin', 'audit'],
        summary: 'CSV of the filtered audit log (capped at 10,000 rows). The export is audited too',
        security,
        querystring: AuditExportQuery,
        produces: ['text/csv'],
        response: { 200: z.string() },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const { csv, truncated } = await service.exportCsv(
          withTx(req),
          requireActor(req),
          req.query,
          auditMeta(req),
        );
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="ccq-audit.csv"')
          .header('x-ccq-truncated', String(truncated))
          .send(csv);
      }),
  );

  app.get(
    '/admin/reports/usage',
    {
      config: { permission: 'audit.read' },
      schema: {
        tags: ['admin', 'reports'],
        summary:
          'Adoption from the audit log (PRD 8.2): daily active users by role, quotes viewed and actions by type. Default: the last 30 days',
        security,
        querystring: UsageReportQuery,
        response: { 200: UsageReportResponse },
      },
    },
    async (req, reply) => handleProblems(req, reply, () => service.usage(withTx(req), req.query)),
  );
};
