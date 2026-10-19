import type { DomainError } from '@ccq/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { problem, sendProblem } from '../plugins/problem-json';

/** A failure a route turns into problem+json (B-09 services). `extra` is merged into the body. */
export class ServiceProblem extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 503,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ServiceProblem';
  }
}

/** Every domain error as problem `errors[]` entries (the UI shows them next to the fields). */
export const problemErrors = (errors: readonly DomainError[]) =>
  errors.map((e) => ({ path: e.field ? `/${e.field}` : '/', message: e.message, code: e.code }));

/** Run a handler; a ServiceProblem becomes its problem+json response. */
export async function handleProblems<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T>,
) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceProblem) {
      return sendProblem(
        reply,
        problem(err.status, req, { detail: err.message, code: err.code, ...err.extra }),
      );
    }
    throw err;
  }
}
