import {
  CapitalReadinessBody,
  PricingQueueQuery,
  PricingQueueResponse,
  PricingRecordBody,
  QuoteNumberParams,
  QuotingDetail,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { PricingService, PricingWithTx } from '../../services/pricing';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-11 pricing queue and Quoting tab (CR-25/26, DEC-19/20/23). G3 goes through the generic gate route
 * (gates.ts). Floors: the queue needs `pricingQueue.read` (Pricing, Leadership, Admin); the two PUTs
 * need `quoting.edit` (Pricing) and the domain limits them to quotes in Quoting. There is no route
 * that takes a price figure.
 */
export const pricingRoutes: FastifyPluginAsyncZod<{ service: PricingService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): PricingWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/queue/pricing',
    {
      config: { permission: 'pricingQueue.read' },
      schema: {
        tags: ['pricing'],
        summary:
          'The pricing queue: open quotes in Quoting (in scope), ordered tier → score → longest in Quoting, with the G2 outcome flag, capital readiness and approval status',
        security,
        querystring: PricingQueueQuery,
        response: { 200: PricingQueueResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.queue(withTx(req), requireActor(req), req.query)),
  );

  app.put(
    '/quotes/:quoteNumber/pricing-record',
    {
      config: { permission: 'quoting.edit' },
      schema: {
        tags: ['pricing'],
        summary:
          'Record the price approval for the current version (only the keys sent change): approver (a Pricing user), time, basis and range notes, ERF/BPR references (format-checked), costing attestation. No price figures',
        security,
        params: QuoteNumberParams,
        body: PricingRecordBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateRecord(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/capital-readiness',
    {
      config: { permission: 'quoting.edit' },
      schema: {
        tags: ['pricing'],
        summary:
          'Set capital readiness (not_required | pending | pre_approved | not_approved), CER reference and notes. Cannot be not_required after a G2 "Capital required"',
        security,
        params: QuoteNumberParams,
        body: CapitalReadinessBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateCapital(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );
};
