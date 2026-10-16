import { Readable } from 'node:stream';

import {
  BoardQuery,
  BoardResponse,
  QuoteExportQuery,
  QuoteListQuery,
  QuoteListResponse,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { PipelineService, PipelineWithTx } from '../../services/pipeline';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/** `stage[]=A&stage[]=B` → `stage=[A, B]`, so bracketed array keys work like repeated ones. */
async function unbracketQuery(req: FastifyRequest) {
  const query = req.query as Record<string, unknown> | undefined;
  if (!query) return;
  for (const key of Object.keys(query)) {
    if (!key.endsWith('[]')) continue;
    const name = key.slice(0, -2);
    const values = [query[name], query[key]].flat().filter((v) => v !== undefined);
    query[name] = values;
    delete query[key];
  }
}

/**
 * B-14 pipeline views (F-07). All three take the same filters (the web app keeps them in the URL):
 * `q`, `stage`, `tier`, `kam`, `engineer`, `productFamily`, `market`, `resin` (arrays: repeated,
 * `key[]=` or comma-separated), `status`, `agedOverDays`, `closeDateFrom/To`, `hasWarnings`,
 * `sfMismatch`. Results are scope-filtered by RLS and the domain policy, and redacted per role.
 * Floors: the list and the board need `quote.read`; the export needs `export.csv`.
 */
export const pipelineRoutes: FastifyPluginAsyncZod<{ service: PipelineService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): PipelineWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/quotes',
    {
      config: { permission: 'quote.read' },
      preValidation: unbracketQuery,
      schema: {
        tags: ['quotes'],
        summary:
          'The quote list (and the prioritization view with `sort=score`): every quote in scope matching the filters, one page at a time. Priority is withheld per `kam_can_see_peer_scores` (and peers’ priority never filters or sorts); commercial columns are null without `quote.read.commercialFields`',
        security,
        querystring: QuoteListQuery,
        response: { 200: QuoteListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.list(withTx(req), requireActor(req), req.query)),
  );

  app.get(
    '/quotes/board',
    {
      config: { permission: 'quote.read' },
      preValidation: unbracketQuery,
      schema: {
        tags: ['quotes'],
        summary:
          'The pipeline board: a column per stage (config order) with count and SF amount total; terminal stages are summed into a collapsed Closed lane (cards with `includeClosed=true`). Each card lists the gate actions the caller may take now (the domain’s availableActions): a drag is offered only where one leads',
        security,
        querystring: BoardQuery,
        response: { 200: BoardResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.board(withTx(req), requireActor(req), req.query)),
  );

  app.get(
    '/quotes/export.csv',
    {
      config: { permission: 'export.csv' },
      preValidation: unbracketQuery,
      schema: {
        tags: ['quotes'],
        summary:
          'CSV of the filtered list, in the list’s order, with the visible columns (`columns=`). Commercial columns only for roles that may see them. More than 5,000 matching quotes is a 422 (narrow the filters). Audited as an `export` with the filters and row count',
        security,
        querystring: QuoteExportQuery,
        produces: ['text/csv'],
        response: { 200: z.string() },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const { lines, rows } = await service.exportCsv(
          withTx(req),
          requireActor(req),
          req.query,
          auditMeta(req),
        );
        const day = new Date().toISOString().slice(0, 10);
        return (
          reply
            .type('text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="ccq-quotes-${day}.csv"`)
            .header('x-ccq-rows', String(rows))
            // Streamed (the schema's string is for OpenAPI; fastify skips serializing streams).
            .send(Readable.from(lines.map((line) => `${line}\r\n`)) as unknown as string)
        );
      }),
  );
};
