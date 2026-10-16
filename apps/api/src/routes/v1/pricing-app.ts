import {
  PricingBprParams,
  PricingBprResponse,
  PricingContext,
  PricingErfParams,
  PricingErfResponse,
  PricingErfSearchQuery,
  PricingErfSearchResponse,
  QuoteNumberParams,
} from '@ccq/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { requireActor } from '../../plugins/auth';
import type { PricingAppService } from '../../services/pricing-app';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];
/** Every pricing-app route: Pricing, EngLead, Approver, Leadership, Admin (architecture §3.3). */
const permission = 'quote.read.commercialFields' as const;

/**
 * B-15 (F-11): read-only pricing-app lookups and a quote's pricing context. Commercial: KAM,
 * Engineer and SalesLeader get 403 on every route. A reader outage is 503 on the lookups and
 * `source.available = false` on the context (the Quoting tab then falls back to manual references).
 * There is no route that writes to the pricing app.
 */
export const pricingAppRoutes: FastifyPluginAsyncZod<{ service: PricingAppService }> = async (
  app,
  { service },
) => {
  app.get(
    '/pricing/erf/:erfNumber',
    {
      config: { permission },
      schema: {
        tags: ['pricing-app'],
        summary:
          'One ERF from the pricing app (read-only, cached 5 min) with the BPRs that follow it. 404 when unknown, 503 when the pricing app is unavailable',
        security,
        params: PricingErfParams,
        response: { 200: PricingErfResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.erf(requireActor(req), req.params.erfNumber)),
  );

  app.get(
    '/pricing/erf',
    {
      config: { permission },
      schema: {
        tags: ['pricing-app'],
        summary:
          'Search ERFs by customer (contains), text (number, title, customer) and/or SF opportunity id; newest first, at most 50',
        security,
        querystring: PricingErfSearchQuery,
        response: { 200: PricingErfSearchResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.searchErfs(requireActor(req), req.query)),
  );

  app.get(
    '/pricing/bpr/:bprNumber',
    {
      config: { permission },
      schema: {
        tags: ['pricing-app'],
        summary: 'One BPR from the pricing app (read-only, cached 5 min). 404 when unknown',
        security,
        params: PricingBprParams,
        response: { 200: PricingBprResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.bpr(requireActor(req), req.params.bprNumber)),
  );

  app.get(
    '/quotes/:quoteNumber/pricing-context',
    {
      config: { permission },
      schema: {
        tags: ['pricing-app'],
        summary:
          "The quote's pricing-app context: quote.erf_number, the pricing record's ERF/BPR references and the SF ERF number resolved to ERF/BPR records, the customer's SPR history, and the CCQ vs SF ERF linkage",
        security,
        params: QuoteNumberParams,
        response: { 200: PricingContext },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const { quoteId, context } = await service.context(
          (fn) => app.withTx(req, fn),
          requireActor(req),
          req.params.quoteNumber,
        );
        req.auditView = { entity: 'quote', entityId: quoteId, quoteId };
        return context;
      }),
  );
};
