import {
  AssignmentBody,
  AssignmentResponse,
  CapacityEvidenceBody,
  EngineeringDetail,
  EngQueueQuery,
  EngQueueResponse,
  EngReviewBody,
  QuoteNumberParams,
  StageTimesResponse,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { EngineeringService, EngWithTx } from '../../services/engineering';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-10 engineering queue and Engineering Review (F-04, F-07, CR-14/15/19, DEC-26). G2 decisions go
 * through the generic gate route (gates.ts). Floors:
 * - the queue needs `engQueue.read` (EngLead, Engineer, Leadership, Admin);
 * - assignment's floor is `quote.read` because a configured backup assigner (R-04) may hold no
 *   queue.assign; the domain then requires queue.assign or the backup setting (403 otherwise);
 * - accept / edit need `engReview.edit`; the domain limits an Engineer to quotes assigned to them.
 */
export const engineeringRoutes: FastifyPluginAsyncZod<{ service: EngineeringService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): EngWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/queue/engineering',
    {
      config: { permission: 'engQueue.read' },
      schema: {
        tags: ['engineering'],
        summary:
          'The engineering queue: open quotes in Engineering Review (in scope), ordered pinned → tier → score → oldest, with business-day aging buckets (not an SLA), assignment, completeness warnings and the caller’s own assignments',
        security,
        querystring: EngQueueQuery,
        response: { 200: EngQueueResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.queue(withTx(req), requireActor(req), req.query)),
  );

  app.post(
    '/quotes/:quoteNumber/assignment',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['engineering'],
        summary:
          'Assign or reassign the engineer (EngLead, Admin or a configured backup assigner). Recorded on the timeline, audited, and the engineer is notified. Re-assigning the same engineer changes nothing',
        security,
        params: QuoteNumberParams,
        body: AssignmentBody,
        response: { 200: AssignmentResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.assign(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body.engineerId,
          auditMeta(req),
        ),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/eng-review/accept',
    {
      config: { permission: 'engReview.edit' },
      schema: {
        tags: ['engineering'],
        summary:
          'Accept (start) the engineering review: the EngLead or the assigned engineer, once per stay in the queue',
        security,
        params: QuoteNumberParams,
        response: { 200: EngineeringDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.accept(withTx(req), requireActor(req), req.params.quoteNumber, auditMeta(req)),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/eng-review',
    {
      config: { permission: 'engReview.edit' },
      schema: {
        tags: ['engineering'],
        summary:
          'Update the Engineering Review solution fields (only the keys sent). The preliminary capital is commercial: write-only for an Engineer; a change rescores the quote',
        security,
        params: QuoteNumberParams,
        body: EngReviewBody,
        response: { 200: EngineeringDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateReview(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/capacity-evidence',
    {
      config: { permission: 'engReview.edit' },
      schema: {
        tags: ['engineering'],
        summary:
          'Replace the capacity evidence rows (CR-19). Assumed effectiveness % is always stated, never defaulted. Commercial numbers omitted by an Engineer keep their stored values',
        security,
        params: QuoteNumberParams,
        body: CapacityEvidenceBody,
        response: { 200: EngineeringDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateCapacity(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.get(
    '/quotes/:quoteNumber/stage-times',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['quotes'],
        summary: 'Time in each stage, excluding holds (computeTimeInStage); feeds B-17',
        security,
        params: QuoteNumberParams,
        response: { 200: StageTimesResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.stageTimes(withTx(req), req.params.quoteNumber)),
  );
};
