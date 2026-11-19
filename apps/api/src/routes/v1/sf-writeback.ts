import {
  SfWritebackPreview,
  SfWritebackPreviewQuery,
  SfWritebackRow,
  SfWritebackRowParams,
  SfWritebackSummary,
  SfWritebackSwitchBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import { handleProblems } from '../../services/problem';
import type { SfWritebackService, SfWritebackWithTx } from '../../services/sfWriteback';

const security = [{ bearerAuth: [] }];
const tags = ['admin', 'salesforce'];

/**
 * FB-29 (N19-01): Admin → Integrations → Salesforce write-back. Reading (the card, the preview) is
 * config.read (Leadership, Admin); the switch, the mode, retry and skip are config.manage (Admin).
 */
export const sfWritebackRoutes: FastifyPluginAsyncZod<{ service: SfWritebackService }> = async (
  app,
  { service },
) => {
  const tx =
    (req: FastifyRequest): SfWritebackWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/admin/salesforce/writeback',
    {
      config: { permission: 'config.read' },
      schema: {
        tags,
        summary:
          'The Salesforce write-back: switch, mode, why nothing is written (when it is not), counts and the latest 50 outbox rows',
        security,
        response: { 200: SfWritebackSummary },
      },
    },
    async (req) => service.summary(tx(req), requireActor(req)),
  );

  app.put(
    '/admin/salesforce/writeback',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags,
        summary:
          'Switch the write-back on or off and set the mode (dry_run, live). Live is refused (422) with the reason unless this environment has a write connection',
        security,
        body: SfWritebackSwitchBody,
        response: { 200: SfWritebackSummary },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.setSwitch(tx(req), requireActor(req), auditMeta(req), req.body),
      ),
  );

  app.post(
    '/admin/salesforce/writeback/:id/retry',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags,
        summary: 'Retry a failed write (pending again, tries counted from zero). Audited',
        security,
        params: SfWritebackRowParams,
        response: { 200: SfWritebackRow },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.retry(tx(req), requireActor(req), auditMeta(req), req.params.id),
      ),
  );

  app.post(
    '/admin/salesforce/writeback/:id/skip',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags,
        summary: 'Skip a failed or pending write: it will not be sent. Audited',
        security,
        params: SfWritebackRowParams,
        response: { 200: SfWritebackRow },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.skip(tx(req), requireActor(req), auditMeta(req), req.params.id),
      ),
  );

  app.get(
    '/admin/salesforce/writeback/preview',
    {
      config: { permission: 'config.read' },
      schema: {
        tags,
        summary:
          'What the current map would send for a quote as it stands (its latest customer outcome and its stage), without queuing anything',
        security,
        querystring: SfWritebackPreviewQuery,
        response: { 200: SfWritebackPreview },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.preview(tx(req), req.query.quoteNumber)),
  );
};
