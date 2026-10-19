import {
  ActivateScoringResponse,
  AdminReasonCodesResponse,
  AdminScoringResponse,
  AdminSettingsResponse,
  AdminUsersResponse,
  AdminValueListsResponse,
  AdminWorkflowResponse,
  ConnectorHealthResponse,
  DecisionLogResponse,
  ScoringPreviewResponse,
  type ActivateScoringDraftBody,
  type CreateReasonCodeBody,
  type CreateValueListEntryBody,
  type DecisionLogQuery,
  type ReorderBody,
  type ScoringModelBody,
  type UpdateGateBody,
  type UpdateOutcomeBody,
  type UpdateReasonCodeBody,
  type UpdateScoringDraftBody,
  type UpdateSettingBody,
  type UpdateStageBody,
  type UpdateUserScopeBody,
  type UpdateValueListEntryBody,
  AdoptionResponse,
  AnalyticsFiltersResponse,
  CycleTimeResponse,
  DashboardResponse,
  FirstPassResponse,
  FlowResponse,
  G1YieldResponse,
  GateComplianceResponse,
  OutcomesResponse,
  OverridesResponse,
  PipelineResponse,
  PriorityResponse,
  type DashboardRole,
  AttachmentDownloadResponse,
  AttachmentListResponse,
  AttachmentUploadResponse,
  BoardResponse,
  QuoteListResponse,
  HandoffResponse,
  MyProposalsResponse,
  OutcomesReport,
  type HandoffBody,
  FinalReviewQueueResponse,
  PricingQueueResponse,
  PricingContext,
  QuotingDetail,
  ReviewSummary,
  type CapitalReadinessBody,
  type PricingRecordBody,
  AssignmentResponse,
  EngineeringDetail,
  EngQueueResponse,
  MarkNotificationReadResponse,
  MarkNotificationsReadResponse,
  NotificationListResponse,
  PreferencesResponse,
  type UpdatePreferencesBody,
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

/** GET /analytics/* filters: US Central days and single or comma-joined dimension values. */
export type AnalyticsQueryParams = {
  from?: string | undefined;
  to?: string | undefined;
  market?: string | undefined;
  productFamily?: string | undefined;
  kam?: string | undefined;
  region?: string | undefined;
};

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
  // B-18 notifications and email preferences
  notifications: (q: { limit?: number; cursor?: string | undefined; unread?: boolean } = {}) =>
    getJson(
      `/api/v1/notifications${queryString({
        limit: q.limit,
        cursor: q.cursor,
        unread: q.unread ? 'true' : undefined,
      })}`,
      NotificationListResponse,
    ),
  markNotificationRead: (id: string) =>
    getJson(`/api/v1/notifications/${encodeURIComponent(id)}/read`, MarkNotificationReadResponse, {
      method: 'POST',
    }),
  markNotificationsRead: () =>
    getJson('/api/v1/notifications/read', MarkNotificationsReadResponse, { method: 'POST' }),
  preferences: () => getJson('/api/v1/me/preferences', PreferencesResponse),
  updatePreferences: (body: UpdatePreferencesBody) =>
    getJson('/api/v1/me/preferences', PreferencesResponse, { method: 'PUT', body }),

  // B-11 pricing queue and the Quoting tab
  pricingQueue: (q: PricingQueueParams = {}) =>
    getJson(`/api/v1/queue/pricing${queryString({ ...q })}`, PricingQueueResponse),
  updatePricingRecord: (quoteNumber: string, body: PricingRecordBody) =>
    getJson(`${quotePath(quoteNumber)}/pricing-record`, QuotingDetail, { method: 'PUT', body }),
  updateCapitalReadiness: (quoteNumber: string, body: CapitalReadinessBody) =>
    getJson(`${quotePath(quoteNumber)}/capital-readiness`, QuotingDetail, { method: 'PUT', body }),
  // B-15 pricing-app context (read-only; commercial roles only, 403 otherwise)
  pricingContext: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/pricing-context`, PricingContext),

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

  // B-17 role dashboards and operational analytics. Every figure is computed on the server.
  dashboard: (role: DashboardRole) => getJson(`/api/v1/dashboards/${role}`, DashboardResponse),
  analyticsFilters: () => getJson('/api/v1/analytics/filters', AnalyticsFiltersResponse),
  analyticsPipeline: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/pipeline${queryString(q)}`, PipelineResponse),
  analyticsCycleTime: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/cycle-time${queryString(q)}`, CycleTimeResponse),
  analyticsFlow: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/flow${queryString(q)}`, FlowResponse),
  analyticsOutcomes: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/outcomes${queryString(q)}`, OutcomesResponse),
  analyticsFirstPass: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/first-pass${queryString(q)}`, FirstPassResponse),
  analyticsG1Yield: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/g1-yield${queryString(q)}`, G1YieldResponse),
  analyticsOverrides: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/overrides${queryString(q)}`, OverridesResponse),
  analyticsGateCompliance: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/gate-compliance${queryString(q)}`, GateComplianceResponse),
  analyticsPriority: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/priority${queryString(q)}`, PriorityResponse),
  analyticsAdoption: (q: AnalyticsQueryParams) =>
    getJson(`/api/v1/analytics/adoption${queryString(q)}`, AdoptionResponse),

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

  // B-16 attachments (uploads: uploadAttachment below, for progress)
  quoteAttachments: (quoteNumber: string) =>
    getJson(`${quotePath(quoteNumber)}/attachments`, AttachmentListResponse),
  draftAttachments: (draftId: string) =>
    getJson(`/api/v1/quotes/drafts/${draftId}/attachments`, AttachmentListResponse),
  /** A short-lived link (the download is authorized and audited server-side first). */
  attachmentLink: (id: string) =>
    getJson(`/api/v1/attachments/${id}/download?format=json`, AttachmentDownloadResponse),
  removeAttachment: (id: string) =>
    getJson(`/api/v1/attachments/${id}`, z.null(), { method: 'DELETE' }),

  // B-19 admin configuration console (reads config.read; writes config.manage, each with a reason)
  admin: {
    valueLists: () => getJson('/api/v1/admin/config/value-lists', AdminValueListsResponse),
    createValueListEntry: (body: CreateValueListEntryBody) =>
      getJson('/api/v1/admin/config/value-lists', Created, { method: 'POST', body }),
    updateValueListEntry: (id: string, body: UpdateValueListEntryBody) =>
      getJson(`/api/v1/admin/config/value-lists/${id}`, Saved, { method: 'PATCH', body }),
    reorderValueList: (listKey: string, body: ReorderBody) =>
      getJson(`/api/v1/admin/config/value-lists/${encodeURIComponent(listKey)}/order`, Ok, {
        method: 'PUT',
        body,
      }),
    reasonCodes: () => getJson('/api/v1/admin/config/reason-codes', AdminReasonCodesResponse),
    createReasonCode: (body: CreateReasonCodeBody) =>
      getJson('/api/v1/admin/config/reason-codes', Created, { method: 'POST', body }),
    updateReasonCode: (id: string, body: UpdateReasonCodeBody) =>
      getJson(`/api/v1/admin/config/reason-codes/${id}`, Saved, { method: 'PATCH', body }),
    reorderReasonCodes: (context: string, body: ReorderBody) =>
      getJson(`/api/v1/admin/config/reason-codes/${encodeURIComponent(context)}/order`, Ok, {
        method: 'PUT',
        body,
      }),
    workflow: () => getJson('/api/v1/admin/config/workflow', AdminWorkflowResponse),
    updateStage: (key: string, body: UpdateStageBody) =>
      getJson(`/api/v1/admin/config/stages/${encodeURIComponent(key)}`, Saved, {
        method: 'PATCH',
        body,
      }),
    updateGate: (key: string, body: UpdateGateBody) =>
      getJson(`/api/v1/admin/config/gates/${encodeURIComponent(key)}`, Saved, {
        method: 'PATCH',
        body,
      }),
    updateOutcome: (gateKey: string, key: string, body: UpdateOutcomeBody) =>
      getJson(
        `/api/v1/admin/config/gates/${encodeURIComponent(gateKey)}/outcomes/${encodeURIComponent(key)}`,
        Saved,
        { method: 'PATCH', body },
      ),
    settings: () => getJson('/api/v1/admin/config/settings', AdminSettingsResponse),
    updateSetting: (key: string, body: UpdateSettingBody) =>
      getJson(`/api/v1/admin/config/settings/${encodeURIComponent(key)}`, Saved, {
        method: 'PATCH',
        body,
      }),
    scoring: () => getJson('/api/v1/admin/config/scoring', AdminScoringResponse),
    previewScoring: (model: ScoringModelBody) =>
      getJson('/api/v1/admin/config/scoring/preview', ScoringPreviewResponse, {
        method: 'POST',
        body: { model },
      }),
    createScoringDraft: (changeReason: string) =>
      getJson(
        '/api/v1/admin/config/scoring/draft',
        z.object({ id: z.string(), modelVersion: z.number() }),
        { method: 'POST', body: { changeReason } },
      ),
    updateScoringDraft: (body: UpdateScoringDraftBody) =>
      getJson('/api/v1/admin/config/scoring/draft', Saved, { method: 'PUT', body }),
    activateScoringDraft: (body: ActivateScoringDraftBody) =>
      getJson('/api/v1/admin/config/scoring/draft/activate', ActivateScoringResponse, {
        method: 'POST',
        body,
      }),
    discardScoringDraft: (body: { version: number; changeReason: string }) =>
      getJson('/api/v1/admin/config/scoring/draft/discard', Ok, { method: 'POST', body }),
    users: () => getJson('/api/v1/admin/users', AdminUsersResponse),
    updateUserScope: (id: string, body: UpdateUserScopeBody) =>
      getJson(`/api/v1/admin/users/${id}/scope`, Ok, { method: 'PUT', body }),
    connectorHealth: () => getJson('/api/v1/admin/integrations/health', ConnectorHealthResponse),
    decisionLog: (q: Partial<DecisionLogQuery>) =>
      getJson(`/api/v1/admin/config/decision-log${queryString(q)}`, DecisionLogResponse),
    decisionLogExport: (q: Partial<DecisionLogQuery>): Promise<Blob> =>
      getCsv(`/api/v1/admin/config/decision-log/export.csv${queryString(q)}`),
  },
};

const Created = z.object({ id: z.string() });
const Saved = z.object({ id: z.string(), version: z.number() });
const Ok = z.object({ ok: z.literal(true) });

/** Where an upload goes: a quote (any stage) or an open intake draft. */
export type AttachmentTarget = { quoteNumber: string } | { draftId: string };

export const attachmentsPath = (target: AttachmentTarget) =>
  'quoteNumber' in target
    ? `${quotePath(target.quoteNumber)}/attachments`
    : `/api/v1/quotes/drafts/${target.draftId}/attachments`;

export interface UploadHandle {
  promise: Promise<AttachmentUploadResponse>;
  abort: () => void;
}

/**
 * Upload one file with progress (XMLHttpRequest: fetch has no upload progress). The text fields go
 * first, `size` included, because the server streams the file straight to SharePoint, whose upload
 * session needs the total up front.
 */
export function uploadAttachment(
  target: AttachmentTarget,
  file: File,
  fields: { kind: string; note?: string },
  onProgress: (fraction: number) => void,
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let aborted = false;
  const send = async (forceRefresh: boolean): Promise<{ status: number; body: unknown }> => {
    const session = getAuthSession();
    if (!session) throw new Error('Not signed in');
    const headers = await session.headers({ forceRefresh });
    const form = new FormData();
    form.append('kind', fields.kind);
    if (fields.note) form.append('note', fields.note);
    form.append('size', String(file.size));
    form.append('file', file, file.name);
    return new Promise((resolve, reject) => {
      if (aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
      const req = new XMLHttpRequest();
      xhr = req;
      req.open('POST', attachmentsPath(target));
      req.setRequestHeader('accept', 'application/json');
      for (const [k, v] of Object.entries(headers)) req.setRequestHeader(k, v);
      req.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      req.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(req.responseText);
        } catch {
          body = null;
        }
        resolve({ status: req.status, body });
      };
      req.onerror = () => reject(new Error('The connection dropped during the upload'));
      req.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
      req.send(form);
    });
  };
  const promise = (async () => {
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (res.status < 200 || res.status >= 300) {
      const parsed = ProblemDetails.safeParse(res.body);
      throw new ApiError(
        parsed.success
          ? parsed.data
          : { type: 'about:blank', title: 'Upload failed', status: res.status },
      );
    }
    return AttachmentUploadResponse.parse(res.body);
  })();
  return {
    promise,
    abort: () => {
      aborted = true;
      xhr?.abort();
    },
  };
}

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
