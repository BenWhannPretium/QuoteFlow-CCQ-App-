import {
  PricingContext,
  PricingErfParams,
  PricingErfResponse,
  PricingHistoryImportQuery,
  PricingHistoryImportResponse,
  PricingHistorySearchQuery,
  PricingHistorySearchResponse,
  PricingHistoryStatusResponse,
  QuoteNumberParams,
} from '@ccq/contracts';
import type {} from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import {
  PricingHistoryError,
  type PricingHistoryService,
  type PricingWithTx,
} from '../../services/pricing-history';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];
/** Pricing history reads: Pricing, PricingLead, EngLead, Approver, Leadership, Admin (§3.3). */
const commercial = 'quote.read.commercialFields' as const;

/**
 * B-15 (F-11), revised: the legacy pricing app's history, imported into CCQ (no live connection).
 * Reads are commercial (KAM, Engineer and SalesLeader get 403). The import and its status are
 * config.manage (Admin). Nothing here writes to, or edits, a pricing-app figure.
 */
export const pricingHistoryRoutes: FastifyPluginAsyncZod<{
  service: PricingHistoryService;
}> = async (app, { service }) => {
  const withTx =
    (req: FastifyRequest): PricingWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/pricing/erf/:erfNumber',
    {
      config: { permission: commercial },
      schema: {
        tags: ['pricing-history'],
        summary:
          'One legacy ERF from the imported pricing history (the newest with this number; "ERF" case and spaces tolerated). 404 when unknown',
        security,
        params: PricingErfParams,
        response: { 200: PricingErfResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.erf(withTx(req), requireActor(req), req.params.erfNumber),
      ),
  );

  app.get(
    '/pricing/history',
    {
      config: { permission: commercial },
      schema: {
        tags: ['pricing-history'],
        summary:
          'Search the pricing history (kind erf | bpr | spr) by customer and/or text (request number, product, item, customer), newest first, at most 50',
        security,
        querystring: PricingHistorySearchQuery,
        response: { 200: PricingHistorySearchResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.search(withTx(req), requireActor(req), req.query)),
  );

  app.get(
    '/quotes/:quoteNumber/pricing-context',
    {
      config: { permission: commercial },
      schema: {
        tags: ['pricing-history'],
        summary:
          "The quote's pricing history: its legacy ERF numbers (quote.erf_number, the pricing record's Legacy ERF #, the SF ERF number) resolved, the customer's other ERFs and SPR history (matched by customer name), and the CCQ vs SF ERF linkage. No BPR (B-26)",
        security,
        params: QuoteNumberParams,
        response: { 200: PricingContext },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const { quoteId, context } = await service.context(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
        );
        req.auditView = { entity: 'quote', entityId: quoteId, quoteId };
        return context;
      }),
  );

  app.get(
    '/admin/pricing-history',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags: ['admin'],
        summary: 'Pricing history: records loaded per kind and the latest imports',
        security,
        response: { 200: PricingHistoryStatusResponse },
      },
    },
    async (req) => service.status(withTx(req)),
  );

  app.post(
    '/admin/pricing-history/import',
    {
      config: { permission: 'config.manage' },
      schema: {
        tags: ['admin'],
        summary:
          'Import the legacy pricing-app export (.xlsx with "ERF Export", "BPR Export", "SPR Export" sheets) as multipart `file`. apply=false (default) checks the file and reports; apply=true upserts it (by kind + request id) in one transaction. 422 for a file that is not the export. Audited',
        security,
        querystring: PricingHistoryImportQuery,
        response: { 200: PricingHistoryImportResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const file = req.isMultipart() ? await req.file() : undefined;
        if (!file) {
          throw new PricingHistoryError(
            422,
            'pricing_history_invalid_file',
            'Attach the export file',
            {
              errors: [{ path: '/file', message: 'Attach the export file', code: 'MISSING_FIELD' }],
            },
          );
        }
        return service.import(
          withTx(req),
          requireActor(req),
          auditMeta(req),
          { fileName: file.filename, stream: file.file },
          req.query.apply,
        );
      }),
  );
};
