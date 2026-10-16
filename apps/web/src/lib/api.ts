import {
  BoardResponse,
  QuoteListResponse,
  HandoffResponse,
  MyProposalsResponse,
  OutcomesReport,
  type HandoffBody,
  FinalReviewQueueResponse,
  PricingQueueResponse,
  QuotingDetail,
  ReviewSummary,
  type CapitalReadinessBody,
  type PricingRecordBody,
  AssignmentResponse,
  EngineeringDetail,
  EngQueueResponse,
  MarkNotificationsReadResponse,
  NotificationListResponse,
  StageTimesResponse,
  type CapacityEvidenceBody,
  type EngReviewBody,
  AuditListResponse,
  CommentResponse,
  OverrideListResponse,
  OverrideLogResponse,
  OverrideResponse,
  TimelineResponse,
  UsageReportResponse,
  UserSearchResponse,
  type AuditExportQuery,
  type AuditQuery,
  type CreateCommentBody,
  type CreateOverrideBody,
  type OverrideLogQuery,
  type TimelineFilter,
  GateDecisionResponse,
  GateQueueResponse,
  QuoteDetail,
  type GateDecisionBody,
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

/** GET /queue/engineering filters (contracts `EngQueueQuery`), as sent on the URL. */
export interface EngQueueParams {
  tier?: string;
  engineer?: string;
  agedOver?: number;
  bucket?: string;
  productFamily?: string;
  q?: string;
}

/** GET /queue/pricing filters (contracts `PricingQueueQuery`), as sent on the URL. */
export interface PricingQueueParams {
  tier?: string;
  g2?: string;
  capital?: string;
  approved?: 'yes' | 'no';
  productFamily?: string;
  kam?: string;
  q?: string;
}

/** GET /approvals?gate=G4 filters (contracts `FinalReviewQueueQuery`), as sent on the URL. */
export interface FinalReviewQueueParams {
  tier?: string;
  g2?: string;
  capital?: string;
  kam?: string;
  q?: string;
}

export const isApiError = (err: unknown, status?: number): err is ApiError =>
  err instanceof ApiError && (status === undefined || err.status === status);

interface RequestOptions {
  /** Statuses whose body is still valid data (health's 503). */
  okStatuses?: number[];
  /** Attach the signed-in user's credentials (every route except public ones). */
  auth?: boolean;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON request body. */
  body?: unknown;
}

/** `?a=1&b=2` from the defined, non-empty values (or ''). */
function queryString(params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

const quotePath = (quoteNumber: string) => `/api/v1/quotes/${encodeURIComponent(quoteNumber)}`;

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

  // B-08 quotes, gates and rework
  quote: (quoteNumber: string) =>
    getJson(`/api/v1/quotes/${encodeURIComponent(quoteNumber)}`, QuoteDetail),
  gateQueue: (gateKey: string) =>
    getJson(`/api/v1/gates/${encodeURIComponent(gateKey)}/queue`, GateQueueResponse),
  decideGate: (quoteNumber: string, gateKey: string, body: GateDecisionBody) =>
    getJson(
      `/api/v1/quotes/${encodeURIComponent(quoteNumber)}/gates/${encodeURIComponent(gateKey)}/decisions`,
      GateDecisionResponse,
      { method: 'POST', body },
    ),
  startRework: (quoteNumber: string) =>
    getJson(`/api/v1/quotes/${encodeURIComponent(quoteNumber)}/rework`, IntakeDraft, {
      method: 'POST',
    }),

  // B-09 governed overrides
  requestOverride: (quoteNumber: string, body: CreateOverrideBody) =>
    getJson(`${quotePath(quoteNumber)}/overrides`, OverrideResponse, { method: 'POST', body }),
  quoteOverrides: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/overrides`, OverrideListResponse),
  overrideInbox: () => getJson('/api/v1/overrides?status=requested', OverrideListResponse),
  approveOverride: (id: string, note?: string) =>
    getJson(`/api/v1/overrides/${id}/approve`, OverrideResponse, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  rejectOverride: (id: string, note: string) =>
    getJson(`/api/v1/overrides/${id}/reject`, OverrideResponse, { method: 'POST', body: { note } }),
  revertOverride: (id: string) =>
    getJson(`/api/v1/overrides/${id}/revert`, OverrideResponse, { method: 'POST' }),
  overrideLog: (q: Partial<OverrideLogQuery>) =>
    getJson(`/api/v1/admin/override-log${queryString(q)}`, OverrideLogResponse),

  // B-09 timeline and comments
  timeline: (quoteNumber: string, p: { filter?: TimelineFilter; cursor?: string | null }) =>
    getJson(
      `${quotePath(quoteNumber)}/timeline${queryString({ filter: p.filter, cursor: p.cursor })}`,
      TimelineResponse,
    ),
  addComment: (quoteNumber: string, body: CreateCommentBody) =>
    getJson(`${quotePath(quoteNumber)}/comments`, CommentResponse, { method: 'POST', body }),
  searchUsers: (q: string) => getJson(`/api/v1/users${queryString({ q })}`, UserSearchResponse),

  // B-10 engineering queue and Engineering Review
  /** List filters are comma-separated (`tier: 'CRITICAL,HIGH'`). */
  engQueue: (q: EngQueueParams = {}) =>
    getJson(`/api/v1/queue/engineering${queryString({ ...q })}`, EngQueueResponse),
  assignEngineer: (quoteNumber: string, engineerId: string) =>
    getJson(`${quotePath(quoteNumber)}/assignment`, AssignmentResponse, {
      method: 'POST',
      body: { engineerId },
    }),
  acceptEngReview: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/eng-review/accept`, EngineeringDetail, { method: 'POST' }),
  updateEngReview: (quoteNumber: string, body: EngReviewBody) =>
    getJson(`${quotePath(quoteNumber)}/eng-review`, EngineeringDetail, { method: 'PUT', body }),
  updateCapacityEvidence: (quoteNumber: string, body: CapacityEvidenceBody) =>
    getJson(`${quotePath(quoteNumber)}/capacity-evidence`, EngineeringDetail, {
      method: 'PUT',
      body,
    }),
  stageTimes: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/stage-times`, StageTimesResponse),
  notifications: () => getJson('/api/v1/notifications', NotificationListResponse),
  markNotificationsRead: () =>
    getJson('/api/v1/notifications/read', MarkNotificationsReadResponse, { method: 'POST' }),

  // B-11 pricing queue and the Quoting tab
  pricingQueue: (q: PricingQueueParams = {}) =>
    getJson(`/api/v1/queue/pricing${queryString({ ...q })}`, PricingQueueResponse),
  updatePricingRecord: (quoteNumber: string, body: PricingRecordBody) =>
    getJson(`${quotePath(quoteNumber)}/pricing-record`, QuotingDetail, { method: 'PUT', body }),
  updateCapitalReadiness: (quoteNumber: string, body: CapitalReadinessBody) =>
    getJson(`${quotePath(quoteNumber)}/capital-readiness`, QuotingDetail, { method: 'PUT', body }),

  // B-12 Final Review: the approvals queue and the one-page review summary (decisions: decideGate, G4)
  finalReviewQueue: (q: FinalReviewQueueParams = {}) =>
    getJson(`/api/v1/approvals${queryString({ gate: 'G4', ...q })}`, FinalReviewQueueResponse),
  reviewSummary: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/review-summary`, ReviewSummary),

  // B-13 customer decision (G5 decisions: decideGate), the hand-off record and the outcomes report
  myProposals: () => getJson('/api/v1/quotes/mine/proposals', MyProposalsResponse),
  updateHandoff: (quoteNumber: string, body: HandoffBody) =>
    getJson(`${quotePath(quoteNumber)}/handoff`, HandoffResponse, { method: 'PUT', body }),
  outcomesReport: () => getJson('/api/v1/admin/reports/outcomes', OutcomesReport),

  // B-09 usage audit (Leadership + Admin)
  auditEvents: (q: Partial<AuditQuery>) =>
    getJson(`/api/v1/admin/audit${queryString(q)}`, AuditListResponse),
  usageReport: (q: { from?: string | undefined; to?: string | undefined }) =>
    getJson(`/api/v1/admin/reports/usage${queryString(q)}`, UsageReportResponse),
  /** The CSV export as a Blob (it needs the bearer token, so it can't be a plain link). */
  auditExport: (q: Partial<AuditExportQuery>): Promise<Blob> =>
    getCsv(`/api/v1/admin/audit/export.csv${queryString(q)}`),

  // B-14 pipeline views. The query is the URL's filters (lib/pipeline-search), passed through.
  quotes: (q: Record<string, string>) =>
    getJson(`/api/v1/quotes${queryString(q)}`, QuoteListResponse),
  board: (q: Record<string, string>) =>
    getJson(`/api/v1/quotes/board${queryString(q)}`, BoardResponse),
  /** The filtered list as CSV (audited server-side; 422 above 5,000 rows). */
  quotesExport: (q: Record<string, string>): Promise<Blob> =>
    getCsv(`/api/v1/quotes/export.csv${queryString(q)}`),
};

async function getCsv(path: string): Promise<Blob> {
  const session = getAuthSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(path, {
    headers: { accept: 'text/csv', ...(await session.headers({ forceRefresh: false })) },
  });
  if (!res.ok) {
    const parsed = ProblemDetails.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      parsed.success
        ? parsed.data
        : { type: 'about:blank', title: res.statusText, status: res.status },
    );
  }
  return res.blob();
}

/** Save a Blob as a file (the CSV exports). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
