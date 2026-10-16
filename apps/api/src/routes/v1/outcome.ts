import {
  HandoffBody,
  HandoffResponse,
  MyProposalsResponse,
  OutcomesReport,
  QuoteNumberParams,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { OutcomeService, OutcomeWithTx } from '../../services/outcome';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-13 customer decision (CR-37/39/41). The G5 decision itself is the generic gate route
 * (`POST /quotes/:qn/gates/G5/decisions`, gates.ts): the domain enforces the closure rule (outcome +
 * reason + owner + date on every terminal path), Expired ≠ Lost, the hold and the versioned re-quote.
 * Floors: proposals need `outcome.record` (the KAM's own quotes), the hand-off `handoff.edit` (checked
 * again on the quote), the report `analytics.read`.
 */
export const outcomeRoutes: FastifyPluginAsyncZod<{ service: OutcomeService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): OutcomeWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/quotes/mine/proposals',
    {
      config: { permission: 'outcome.record' },
      schema: {
        tags: ['outcome'],
        summary:
          "My open proposals: the caller's quotes waiting for the customer (Customer Decision, on hold included), soonest validity end first, with the validity countdown and the SF stage side by side",
        security,
        response: { 200: MyProposalsResponse },
      },
    },
    async (req) => service.myProposals(withTx(req), requireActor(req)),
  );

  app.put(
    '/quotes/:quoteNumber/handoff',
    {
      config: { permission: 'handoff.edit' },
      schema: {
        tags: ['outcome'],
        summary:
          'Edit the minimal hand-off record of an AWARDED quote: acceptance evidence, CER ID and BPR ID (references only), receiving role and contact, accepted-by date, notes, and the "Hand-off complete" tick (records who). Only the keys sent change. 409 unless AWARDED',
        security,
        params: QuoteNumberParams,
        body: HandoffBody,
        response: { 200: HandoffResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.putHandoff(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.get(
    '/admin/reports/outcomes',
    {
      config: { permission: 'analytics.read' },
      schema: {
        tags: ['outcome', 'admin'],
        summary:
          'Outcomes report: counts by outcome and reason (customer outcomes vs internal no-gos; Expired is not Lost), the win rate (awarded ÷ awarded + lost) and the outcome capture rate (recorded ÷ recorded + gone dark)',
        security,
        response: { 200: OutcomesReport },
      },
    },
    async (req) => service.report(withTx(req)),
  );
};
