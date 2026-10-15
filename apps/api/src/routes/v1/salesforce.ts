import {
  SfOpportunityDetail,
  SfOpportunityIdParams,
  SfOpportunitySearchQuery,
  SfOpportunitySearchResponse,
} from '@ccq/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { problem, sendProblem } from '../../plugins/problem-json';
import type { SalesforceService } from '../../services/salesforce';

/** Salesforce opportunity picker and panel (B-06). Read-only toward SF. */
export const salesforceRoutes: FastifyPluginAsyncZod<{ service: SalesforceService }> = async (
  app,
  { service },
) => {
  app.get(
    '/salesforce/opportunities',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags: ['salesforce'],
        summary:
          'Search SF opportunities for intake: local snapshot first (trigram on name and account), SF live when fewer than 5 hits',
        security: [{ bearerAuth: [] }],
        querystring: SfOpportunitySearchQuery,
        response: { 200: SfOpportunitySearchResponse },
      },
    },
    async (req) => {
      const user = req.currentUser!;
      return service.search(
        (fn) => app.withTx(req, fn),
        { email: user.email ?? null, upn: user.upn },
        req.query,
      );
    },
  );

  app.get(
    '/salesforce/opportunities/:id',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['salesforce'],
        summary:
          'One SF opportunity: snapshot + live refresh (cached 60 s), with account, ship-to, ERF number, quote source, stage and product specs',
        security: [{ bearerAuth: [] }],
        params: SfOpportunityIdParams,
        response: { 200: SfOpportunityDetail },
      },
    },
    async (req, reply) => {
      const detail = await service.detail((fn) => app.withTx(req, fn), req.params.id);
      if (!detail) {
        return sendProblem(
          reply,
          problem(404, req, {
            detail: 'No Salesforce opportunity with this id',
            code: 'not_found',
          }),
        );
      }
      return detail;
    },
  );
};
