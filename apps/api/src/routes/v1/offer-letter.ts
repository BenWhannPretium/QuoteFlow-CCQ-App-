import {
  GenerateOfferLetterBody,
  GenerateOfferLetterResponse,
  OfferLetterResponse,
  QuoteNumberParams,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { OfferLetterService, OfferLetterWithTx } from '../../services/offer-letter';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * FB-20 (F-070): the customer offer letter. Floors: reading needs `offer.read` (every role that reads
 * the quote), generating needs `offer.generate` (checked again on the quote: the KAM on their own,
 * a sales leader, Pricing, an Admin). The file is downloaded through `GET /attachments/:id/download`,
 * which authorizes and audits each download.
 */
export const offerLetterRoutes: FastifyPluginAsyncZod<{ service: OfferLetterService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): OfferLetterWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/quotes/:quoteNumber/offer-letter',
    {
      config: { permission: 'offer.read' },
      schema: {
        tags: ['outcome'],
        summary:
          'The offer letter: whether one can be generated (only after Final Review approves the quote; blockers and warnings in plain words), what it will print (the prices read from the current costing workbook, read-only), where the prices come from, and the letters generated so far (Superseded after a re-quote)',
        security,
        params: QuoteNumberParams,
        response: { 200: OfferLetterResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.view(withTx(req), requireActor(req), req.params.quoteNumber),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/offer-letter',
    {
      config: { permission: 'offer.generate' },
      schema: {
        tags: ['outcome'],
        summary:
          'Generate the offer letter (Word): re-checks readiness on the server with the quote locked, needs every warning acknowledged (409 otherwise), snapshots the prices, stores the .docx as an offer_letter file and audits it (no prices or customer text in the audit row). Each call makes a new letter number',
        security,
        params: QuoteNumberParams,
        body: GenerateOfferLetterBody,
        response: { 201: GenerateOfferLetterResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const out = await service.generate(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        );
        void reply.code(201);
        return out;
      }),
  );
};
