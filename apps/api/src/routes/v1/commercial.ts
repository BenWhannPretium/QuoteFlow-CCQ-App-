import {
  CapitalFlagBody,
  CapitalTermsBody,
  EngineeringTermsBody,
  EscalationBody,
  EscalationResponse,
  QuoteDetail,
  G4SignoffBody,
  QuoteNumberParams,
  TermsBody,
  TermsExceptionDecisionBody,
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
          'B-26 / FB-08: the Sales and Pricing terms: payment terms (a list; non-standard opens an exception for the pricing lead), tooling payment milestones, the tooling commitment, the terms check, the Legal review, and the capital terms as a pre-fill. Only the keys sent change; changing a term clears the check. MOQ and tooling funding are /terms/engineering',
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

  // FB-08 (F-021, D-003 provisional): MOQ and tooling funding are Engineering's.
  app.put(
    '/quotes/:quoteNumber/terms/engineering',
    {
      config: { permission: 'terms.engineering.edit' },
      schema: {
        tags: ['commercial'],
        summary:
          'FB-08 (F-021): MOQ and the tooling funding model, by Engineering (EngLead, or the assigned Engineer). Only the keys sent change; a change clears the terms check and the approver’s capital-terms confirmation',
        security,
        params: QuoteNumberParams,
        body: EngineeringTermsBody,
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
          'engineering',
        ),
      ),
  );

  // FB-08 (F-068, T-031): the approver edits and confirms the capital terms at Final Review.
  app.put(
    '/quotes/:quoteNumber/terms/capital',
    {
      config: { permission: 'terms.finalize' },
      schema: {
        tags: ['commercial'],
        summary:
          'FB-08 (F-068): the capital terms (funding model, mold ownership, amortization, minimum supply / shortfall, agreement and duration), edited and confirmed (finalized: true) by the Approver while the quote is in Final Review. G4 Advance needs the confirmation (g4_required_checks terms_finalized); the terms lock at G4 Approve',
        security,
        params: QuoteNumberParams,
        body: CapitalTermsBody,
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
          'finalize',
        ),
      ),
  );

  // FB-08 (T-007): the pricing lead decides a non-standard payment-terms exception.
  app.post(
    '/quotes/:quoteNumber/terms/exception/decision',
    {
      config: { permission: 'terms.exception.decide' },
      schema: {
        tags: ['commercial'],
        summary:
          'FB-08 (T-007): approve or reject the pending payment-terms exception, with a rationale. Whoever entered the terms and the KAM are told. G4 Advance waits while it is pending or rejected (g4_required_checks terms_exception)',
        security,
        params: QuoteNumberParams,
        body: TermsExceptionDecisionBody,
        response: { 200: QuoteDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.decideTermsException(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  // FB-08 (F-082, off until A-035): an extra Final Review sign-off.
  app.post(
    '/quotes/:quoteNumber/final-review/signoffs',
    {
      config: { permission: 'finalReview.signoff' },
      schema: {
        tags: ['commercial'],
        summary:
          'FB-08 (F-082): record an extra Final Review sign-off that app_setting g4_additional_approvals asks for (seeded off). In order, by the sign-off’s role, while the quote is in Final Review; G4 Approve waits for all of them',
        security,
        params: QuoteNumberParams,
        body: G4SignoffBody,
        response: { 200: QuoteDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.signoff(
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
