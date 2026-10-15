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

/** RFC 9457 problem+json for every error and 404. Never leaks internals on 5xx. */
export const problemJsonPlugin = fp(
  (app: FastifyInstance, opts: ProblemJsonOptions) => {
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
