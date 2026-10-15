import {
  AuthConfigResponse,
  HealthResponse,
  MeResponse,
  ProblemDetails,
  PublicConfigResponse,
} from '@ccq/contracts';
import type { z } from 'zod';

import { getAuthSession } from '@/auth/session';

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get status() {
    return this.problem.status;
  }
}

export const isApiError = (err: unknown, status?: number): err is ApiError =>
  err instanceof ApiError && (status === undefined || err.status === status);

interface RequestOptions {
  /** Statuses whose body is still valid data (health's 503). */
  okStatuses?: number[];
  /** Attach the signed-in user's credentials (every route except public ones). */
  auth?: boolean;
}

async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  { okStatuses = [], auth = true }: RequestOptions = {},
): Promise<z.infer<S>> {
  const send = async (forceRefresh: boolean) => {
    const session = auth ? getAuthSession() : null;
    if (auth && !session) throw new Error('Not signed in');
    const authHeaders = session ? await session.headers({ forceRefresh }) : {};
    return fetch(path, { headers: { accept: 'application/json', ...authHeaders } });
  };

  let res = await send(false);
  // A 401 usually means a stale token: re-acquire once, then give up.
  if (res.status === 401 && auth) res = await send(true);

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
  health: () => getJson('/api/v1/health', HealthResponse, { okStatuses: [503], auth: false }),
  authConfig: () => getJson('/api/v1/auth/config', AuthConfigResponse, { auth: false }),
  me: () => getJson('/api/v1/me', MeResponse),
  publicConfig: () => getJson('/api/v1/config/public', PublicConfigResponse),
};
