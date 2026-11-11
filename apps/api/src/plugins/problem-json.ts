import { STATUS_CODES } from 'node:http';

import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@ccq/contracts';
import { ForbiddenError } from '@ccq/domain';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export function problem(
  status: number,
  request: FastifyRequest,
  extra: Partial<ProblemDetails> = {},
): ProblemDetails {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    instance: request.url,
    traceId: request.id,
    ...extra,
  };
}

export function sendProblem(reply: FastifyReply, body: ProblemDetails) {
  return reply.status(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

export interface ProblemJsonOptions {
  /** Production: serve index.html for unknown non-API GETs (SPA client routes). */
  spaFallback?: boolean;
}

/**
 * DR-cross-cutting-03: the first NUL character (`\u0000`) in a request's text, as a JSON-pointer path.
 * Postgres cannot store it in `text`, so it used to end in a bare 500. Pasted PDF or Excel text can carry
 * one. Plain objects and arrays are walked; anything else (a multipart stream) is left to its route.
 */
export function findNulPath(value: unknown, path = ''): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path || '/' : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNulPath(value[i], `${path}/${i}`);
      if (found) return found;
    }
    return null;
  }
  const proto: unknown =
    value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  // A plain object, or Fastify's query object (null prototype).
  if (value && (proto === Object.prototype || proto === null)) {
    for (const [key, v] of Object.entries(value)) {
      if (key.includes('\u0000')) return `${path}/${key}`;
      const found = findNulPath(v, `${path}/${key}`);
      if (found) return found;
    }
  }
  return null;
}

/** RFC 9457 problem+json for every error and 404. Never leaks internals on 5xx. */
export const problemJsonPlugin = fp(
  (app: FastifyInstance, opts: ProblemJsonOptions) => {
    // DR-cross-cutting-03: refuse a NUL character anywhere in the path, query or body, before any hook,
    // schema or handler sees it: 400 "contains an invalid character", never a 500. The path and query
    // are checked first thing (onRequest: later hooks already read them), the body once it is parsed.
    const refuseNul = (
      request: FastifyRequest,
      reply: FastifyReply,
      parts: readonly (readonly ['body' | 'query' | 'params', unknown])[],
    ) => {
      for (const [part, value] of parts) {
        const at = findNulPath(value);
        if (!at) continue;
        return sendProblem(
          reply,
          problem(400, request, {
            title: 'Validation failed',
            detail:
              'The request contains an invalid character (a NUL character). Remove it and try again.',
            code: 'invalid_character',
            errors: [
              {
                path: part === 'body' ? at : `/${part}${at === '/' ? '' : at}`,
                message: 'Contains an invalid character',
              },
            ],
          }),
        );
      }
      return undefined;
    };
    app.addHook('onRequest', async (request, reply) => {
      const sent = refuseNul(request, reply, [
        ['query', request.query],
        ['params', request.params],
      ]);
      if (sent) return sent;
      // The raw URL, for a NUL the query parser may have dropped.
      if (/%00/.test(request.url)) {
        return refuseNul(request, reply, [['query', { url: '\u0000' }]]);
      }
      return undefined;
    });
    app.addHook('preValidation', async (request, reply) =>
      refuseNul(request, reply, [['body', request.body]]),
    );

    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (hasZodFastifySchemaValidationErrors(error)) {
        return sendProblem(
          reply,
          problem(400, request, {
            title: 'Validation failed',
            detail: `Request ${error.validationContext ?? 'input'} is invalid`,
            errors: error.validation.map((v) => ({
              path: v.instancePath || '/',
              message: v.message ?? 'invalid',
            })),
          }),
        );
      }

      if (error instanceof ForbiddenError) {
        return sendProblem(
          reply,
          problem(403, request, {
            detail: `You do not have permission to do this (${error.permission})`,
            code: 'forbidden',
            permission: error.permission,
          }),
        );
      }

      const status =
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
          ? error.statusCode
          : 500;

      if (status >= 500) {
        request.log.error({ err: error }, 'unhandled error');
        return sendProblem(reply, problem(status, request));
      }
      return sendProblem(reply, problem(status, request, { detail: error.message }));
    });

    app.setNotFoundHandler((request, reply) => {
      const isApi = request.url === '/api' || request.url.startsWith('/api/');
      const isPageLoad = request.method === 'GET' || request.method === 'HEAD';
      if (opts.spaFallback && !isApi && isPageLoad) {
        // Client-side route: let the SPA router handle it (sendFile comes from spaPlugin).
        return reply.type('text/html').sendFile('index.html');
      }
      return sendProblem(
        reply,
        problem(404, request, { detail: `No route for ${request.method} ${request.url}` }),
      );
    });
  },
  { name: 'problem-json' },
);
