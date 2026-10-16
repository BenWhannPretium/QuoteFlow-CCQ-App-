import {
  FinalReviewQueueQuery,
  FinalReviewQueueResponse,
  QuoteNumberParams,
  ReviewSummary,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { requireActor } from '../../plugins/auth';
import type { FinalReviewService, FinalReviewWithTx } from '../../services/final-review';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-12 Final Review (G4, CR-29): the approvals queue and the one-page review summary. Both only read.
 * The decision is the generic gate route, `POST /quotes/:qn/gates/G4/decisions` (gates.ts): its domain
 * checks cover segregation (not the KAM, not the price approver), the optional approver tier, the note
 * and reason on Decline, and the target on Return. Approve and Decline never set Awarded or Lost.
 * Floors: the queue needs `finalReview.read` (Approver, Leadership, Admin); the summary needs
 * `quote.read` and strips commercial parts for roles without `quote.read.commercialFields`.
 */
export const finalReviewRoutes: FastifyPluginAsyncZod<{ service: FinalReviewService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): FinalReviewWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/approvals',
    {
      config: { permission: 'finalReview.read' },
      schema: {
        tags: ['final-review'],
        summary:
          'The Final Review (G4) approvals queue: open quotes waiting for release (in scope), ordered tier → score → longest waiting, with price approval, capital readiness, G2 risk flags, the KAM and the Pricing approver, and whether the caller may decide each (segregation, approver tier)',
        security,
        querystring: FinalReviewQueueQuery,
        response: { 200: FinalReviewQueueResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.queue(withTx(req), requireActor(req), req.query)),
  );

  app.get(
    '/quotes/:quoteNumber/review-summary',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['final-review'],
        summary:
          'The one-page review snapshot: intake, score breakdown, engineering solution and capacity evidence, price approval (basis, range note), capital readiness, attachments, open warnings, decisions so far and the G4 actions the caller may take. Commercial parts are redacted per role. Audited as a view',
        security,
        params: QuoteNumberParams,
        response: { 200: ReviewSummary },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const dto = await service.reviewSummary(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
        );
        req.auditView = { entity: 'quote', entityId: dto.quote.id, quoteId: dto.quote.id };
        return dto;
      }),
  );
};
