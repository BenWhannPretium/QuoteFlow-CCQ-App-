import { HealthResponse, ProblemDetails } from '@ccq/contracts';
import type { z } from 'zod';

// TODO(B-04): attach the MSAL access token (Authorization: Bearer) to every request.

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  { okStatuses = [] as number[] } = {},
): Promise<z.infer<S>> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok && !okStatuses.includes(res.status)) {
    const parsed = ProblemDetails.safeParse(body);
    throw new ApiError(
      parsed.success
        ? parsed.data
        : { type: 'about:blank', title: res.statusText, status: res.status },
    );
  }
  return schema.parse(body);
}

export const api = {
  // 503 still carries a valid health body (db: down), so treat it as data, not an error.
  health: () => getJson('/api/v1/health', HealthResponse, { okStatuses: [503] }),
};
