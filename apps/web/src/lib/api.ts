import {
  AuthConfigResponse,
  IntakeDraft,
  IntakeDraftListResponse,
  SfOpportunityDetail,
  SfOpportunitySearchResponse,
  SubmitIntakeResponse,
  type CreateIntakeDraftBody,
  type PatchIntakeDraftBody,
  ErfLinkageResponse,
  HealthResponse,
  IntegrationRunsResponse,
  MeResponse,
  ProblemDetails,
  PublicConfigResponse,
  SfSyncTriggerResponse,
} from '@ccq/contracts';
import { z } from 'zod';

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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON request body. */
  body?: unknown;
}

async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  { okStatuses = [], auth = true, method = 'GET', body }: RequestOptions = {},
): Promise<z.infer<S>> {
  const send = async (forceRefresh: boolean) => {
    const session = auth ? getAuthSession() : null;
    if (auth && !session) throw new Error('Not signed in');
    const authHeaders = session ? await session.headers({ forceRefresh }) : {};
    const headers: Record<string, string> = { accept: 'application/json', ...authHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let res = await send(false);
  // A 401 usually means a stale token: re-acquire once, then give up.
  if (res.status === 401 && auth) res = await send(true);

  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok && !okStatuses.includes(res.status)) {
    const parsed = ProblemDetails.safeParse(payload);
    throw new ApiError(
      parsed.success
        ? parsed.data
        : { type: 'about:blank', title: res.statusText, status: res.status },
    );
  }
  return schema.parse(payload);
}

export const api = {
  // 503 still carries a valid health body (db: down), so treat it as data, not an error.
  health: () => getJson('/api/v1/health', HealthResponse, { okStatuses: [503], auth: false }),
  authConfig: () => getJson('/api/v1/auth/config', AuthConfigResponse, { auth: false }),
  me: () => getJson('/api/v1/me', MeResponse),
  publicConfig: () => getJson('/api/v1/config/public', PublicConfigResponse),
  integrationRuns: (source?: string) =>
    getJson(
      `/api/v1/admin/integrations${source ? `?source=${encodeURIComponent(source)}` : ''}`,
      IntegrationRunsResponse,
    ),
  // 202 = still running after 25 s; the body is still a valid result.
  syncSalesforce: () =>
    getJson('/api/v1/admin/salesforce/sync', SfSyncTriggerResponse, {
      method: 'POST',
      okStatuses: [202],
    }),
  erfLinkage: () => getJson('/api/v1/admin/reports/erf-linkage', ErfLinkageResponse),

  // B-07 intake
  searchOpportunities: (p: { q: string; mine: boolean; limit?: number }) => {
    const qs = new URLSearchParams({
      q: p.q,
      mine: String(p.mine),
      openOnly: 'true',
      limit: String(p.limit ?? 20),
    });
    return getJson(`/api/v1/salesforce/opportunities?${qs}`, SfOpportunitySearchResponse);
  },
  opportunity: (id: string) =>
    getJson(`/api/v1/salesforce/opportunities/${encodeURIComponent(id)}`, SfOpportunityDetail),
  listDrafts: () => getJson('/api/v1/quotes/drafts?mine=true', IntakeDraftListResponse),
  getDraft: (id: string) => getJson(`/api/v1/quotes/drafts/${id}`, IntakeDraft),
  createDraft: (body: CreateIntakeDraftBody) =>
    getJson('/api/v1/quotes/drafts', IntakeDraft, { method: 'POST', body }),
  patchDraft: (id: string, body: PatchIntakeDraftBody) =>
    getJson(`/api/v1/quotes/drafts/${id}`, IntakeDraft, { method: 'PATCH', body }),
  deleteDraft: (id: string) =>
    getJson(`/api/v1/quotes/drafts/${id}`, z.null(), { method: 'DELETE' }),
  submitDraft: (id: string) =>
    getJson(`/api/v1/quotes/drafts/${id}/submit`, SubmitIntakeResponse, { method: 'POST' }),
};
