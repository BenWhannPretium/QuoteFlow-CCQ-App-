import {
  CapitalFlagBody,
  EscalationBody,
  EscalationResponse,
  QuoteDetail,
  QuoteNumberParams,
  TermsBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { CommercialService, CommercialWithTx } from '../../services/commercial';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-26 (CCQ demo 10/20 and the future-state deck): the "capital likely" flag, the commercial terms and
 * Legal review, and escalations. KAM grants are on their own quotes, an Engineer's on assigned ones:
 * the domain checks the qualifier (403 otherwise). None of these routes takes a price figure.
 */
export const commercialRoutes: FastifyPluginAsyncZod<{ service: CommercialService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): CommercialWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.put(
    '/quotes/:quoteNumber/capital-flag',
    {
      config: { permission: 'capitalFlag.edit' },
      schema: {
        tags: ['commercial'],
        summary:
          'B-26: flag or clear "significant capital likely" (Sales or upfront Engineering). The first flag gives Capital Management early notice (awareness, not approval); a flagged quote needs capital readiness confirmed at G3',
        security,
        params: QuoteNumberParams,
        body: CapitalFlagBody,
        response: { 200: QuoteDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.setCapitalFlag(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/terms',
    {
      config: { permission: 'terms.edit' },
      schema: {
        tags: ['commercial'],
        summary:
          'B-26: the commercial terms (tooling funding model, tooling commitment, MOQ, payment terms), the terms check and the Legal review. Only the keys sent change; changing a term clears the check. G4 Advance needs the check, and the Legal review when a trigger applies',
        security,
        params: QuoteNumberParams,
        body: TermsBody,
        response: { 200: QuoteDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateTerms(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/escalations',
    {
      config: { permission: 'quote.escalate' },
      schema: {
        tags: ['commercial'],
        summary:
          'B-26: escalate a concern of a configured type (app_setting escalation_routes) with a note. Recorded on the timeline and audited; the route’s roles, named users and the CCQ Process Owner are told. Never changes the quote',
        security,
        params: QuoteNumberParams,
        body: EscalationBody,
        response: { 200: EscalationResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.escalate(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );
};
