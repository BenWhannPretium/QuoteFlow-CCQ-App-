import { Transform, type Readable } from 'node:stream';

import type { ModelSummaryListResponse, ModelSummaryView } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getSetting,
  listAttachments,
  listModelSummaries,
  listUsersByIds,
  type ModelSummaryFieldRow,
  type ModelSummaryRow,
} from '@ccq/db/repos';
import {
  MODEL_SUMMARY_KINDS,
  MODEL_SUMMARY_LIMITS_SEED,
  activeTemplates,
  extractModelSummary,
  modelSummaryReasonText,
  modelSummaryWarnings,
  parseModelSummaryLimits,
  parseModelSummaryTemplates,
  parseModelSummaryVisible,
  sheetsToRead,
  unavailableSummary,
  type ExtractedField,
  type ModelSummaryExtraction,
  type ModelSummaryKind,
  type ModelSummaryLimits,
  type ModelSummaryTemplate,
} from '@ccq/domain';
import { readWorkbookCells, WorkbookReadError } from '@ccq/integrations';

/**
 * FB-14 (F-031 summary half, D-013): the one-page summary of an uploaded Quoting model.
 *
 * At upload (`AttachmentService.upload`), after the type sniff and size checks, the bytes that stream
 * to the file store are also kept in memory up to `model_summary_limits.maxBytes`; once the file is
 * stored the workbook is read (cached values only, time- and cell-capped) against the active maps in
 * `model_summary_templates`. A failure never blocks the upload: the summary is stored as unavailable,
 * with a reason that names no cell content. The summary of each version is kept with it.
 */

export interface ModelSummarySettings {
  templates: ModelSummaryTemplate[];
  limits: ModelSummaryLimits;
  visible: boolean;
}

/**
 * The admin console validates these settings, so a malformed value only comes from a hand edit: the
 * maps fall back to none (nothing is read, "not configured"), the limits to the seed, and visibility
 * to off (never show figures on a setting nobody can read).
 */
export async function loadModelSummarySettings(db: DbOrTx): Promise<ModelSummarySettings> {
  const [templates, limits, visible] = await Promise.all([
    getSetting(db, 'model_summary_templates'),
    getSetting(db, 'model_summary_limits'),
    getSetting(db, 'model_summary_visible'),
  ]);
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    templates: safe(() => parseModelSummaryTemplates(templates), []),
    limits: safe(() => parseModelSummaryLimits(limits), { ...MODEL_SUMMARY_LIMITS_SEED }),
    visible: safe(() => parseModelSummaryVisible(visible), false),
  };
}

export const isSummaryKind = (kind: string): kind is ModelSummaryKind =>
  (MODEL_SUMMARY_KINDS as readonly string[]).includes(kind);

/**
 * A pass-through that also keeps the bytes, up to `maxBytes`. Past the cap it keeps nothing more
 * (`overflowed`), so a large upload still streams to the store and only the summary is skipped.
 */
export function collectUpTo(maxBytes: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  let overflowed = false;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!overflowed) {
        length += chunk.length;
        if (length > maxBytes) {
          overflowed = true;
          chunks.length = 0;
        } else {
          chunks.push(chunk);
        }
      }
      done(null, chunk);
    },
  });
  return {
    tap,
    result: (): Buffer | null => (overflowed ? null : Buffer.concat(chunks)),
  };
}

export function pipeThrough(stream: Readable, tap: Transform): Readable {
  stream.on('error', (err) => tap.destroy(err));
  return stream.pipe(tap);
}

export interface SummaryRun {
  extraction: ModelSummaryExtraction;
  template: ModelSummaryTemplate | null;
  durationMs: number;
}

/**
 * Read the summary of an uploaded model workbook. Never throws: every failure is an unavailable
 * summary with its reason. `bytes` null means the file was over the size cap.
 */
export async function runModelSummary(
  kind: ModelSummaryKind,
  bytes: Buffer | null,
  settings: Pick<ModelSummarySettings, 'templates' | 'limits'>,
  now: () => number = () => Date.now(),
): Promise<SummaryRun> {
  const start = now();
  const done = (extraction: ModelSummaryExtraction): SummaryRun => ({
    extraction,
    template: settings.templates.find((t) => t.templateId === extraction.templateId) ?? null,
    durationMs: Math.max(0, Math.round(now() - start)),
  });
  // No active map for the kind: nothing to read (quiet). Checked before touching the bytes.
  if (activeTemplates(settings.templates, kind).length === 0) {
    return done(extractModelSummary(EMPTY, settings.templates, kind));
  }
  if (bytes === null || bytes.length > settings.limits.maxBytes) {
    return done(unavailableSummary('too_large'));
  }
  try {
    const snapshot = await readWorkbookCells(bytes, {
      sheetsToRead: (names) => sheetsToRead(settings.templates, kind, names),
      timeoutMs: settings.limits.timeoutMs,
      maxCells: settings.limits.maxCells,
    });
    return done(extractModelSummary(snapshot, settings.templates, kind));
  } catch (err) {
    if (err instanceof WorkbookReadError) {
      return done(
        unavailableSummary(
          err.code === 'TIMED_OUT'
            ? 'timed_out'
            : err.code === 'TOO_MANY_CELLS'
              ? 'too_large'
              : 'unreadable',
        ),
      );
    }
    return done(unavailableSummary('unreadable'));
  }
}

const EMPTY = { sheetNames: [], definedNames: [], cells: new Map() };

/** The field rows to store for an extraction. */
export function summaryFieldRows(fields: readonly ExtractedField[]) {
  return fields.map((f) => ({
    fieldKey: f.key,
    label: f.label,
    unit: f.unit,
    valueType: f.type,
    sheet: f.sheet,
    cellRef: f.ref,
    definedName: f.definedName,
    state: f.state,
    valueNumber: f.number,
    valueText: f.text,
    valueDate: f.date,
    headline: f.headline,
    proposed: f.proposed,
  }));
}

const HIDDEN_TEXT =
  'An Admin has turned off showing figures read from uploaded models. The files and their versions are on the steps above.';

const KIND_ORDER: Record<ModelSummaryKind, number> = {
  cost_model: 0,
  roi_model: 1,
  price_table: 2,
};

function fieldsOf(rows: readonly ModelSummaryFieldRow[]): ExtractedField[] {
  return rows.map((f) => ({
    key: f.fieldKey,
    label: f.label,
    unit: f.unit as ExtractedField['unit'],
    type: f.valueType as ExtractedField['type'],
    sheet: f.sheet,
    ref: f.cellRef,
    definedName: f.definedName,
    state: f.state as ExtractedField['state'],
    number: f.valueNumber === null ? null : Number(f.valueNumber),
    text: f.valueText,
    date: f.valueDate,
    headline: f.headline,
    proposed: f.proposed,
  }));
}

/**
 * The summaries of the quote's current Quoting models (costing, payback, price table), for the
 * Quoting tab and Final Review. The caller has `quote.read.commercialFields` (the route) and reads the
 * quote (RLS and the service's check). With `model_summary_visible` off, no figure leaves the server.
 */
export async function modelSummariesView(
  db: DbOrTx,
  quoteId: string,
): Promise<ModelSummaryListResponse> {
  const settings = await loadModelSummarySettings(db);
  if (!settings.visible) return { visible: false, hiddenText: HIDDEN_TEXT, summaries: [] };
  const current = (await listAttachments(db, quoteId))
    .filter(
      (a) => isSummaryKind(a.kind) && a.version !== null && a.supersededAt === null && !a.removedAt,
    )
    .sort(
      (a, b) => KIND_ORDER[a.kind as ModelSummaryKind] - KIND_ORDER[b.kind as ModelSummaryKind],
    );
  if (current.length === 0) return { visible: true, hiddenText: null, summaries: [] };
  const [summaries, users] = await Promise.all([
    listModelSummaries(
      db,
      current.map((a) => a.id),
    ),
    listUsersByIds(db, [...new Set(current.map((a) => a.uploadedBy))]),
  ]);
  const byAttachment = new Map(summaries.map((s) => [s.attachmentId, s]));
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return {
    visible: true,
    hiddenText: null,
    summaries: current.map((a) =>
      summaryView(a, byAttachment.get(a.id) ?? null, names, settings.templates),
    ),
  };
}

function summaryView(
  a: {
    id: string;
    kind: string;
    version: number | null;
    fileName: string;
    uploadedBy: string;
    createdAt: Date;
  },
  s: (ModelSummaryRow & { fields: ModelSummaryFieldRow[] }) | null,
  names: Map<string, string>,
  templates: readonly ModelSummaryTemplate[],
): ModelSummaryView {
  const base = {
    attachmentId: a.id,
    kind: a.kind as ModelSummaryKind,
    version: a.version ?? 1,
    fileName: a.fileName,
    uploadedByName: names.get(a.uploadedBy) ?? null,
    uploadedAt: a.createdAt.toISOString(),
  };
  if (!s) {
    return {
      ...base,
      status: 'none',
      reason: null,
      reasonText:
        'No summary was read for this version (it was uploaded before QuoteFlow read summaries). Upload it again to see one.',
      templateId: null,
      templateLabel: null,
      mapProvisional: null,
      extractedAt: null,
      fields: [],
      warnings: [],
    };
  }
  const template = templates.find((t) => t.templateId === s.templateId) ?? null;
  const fields = fieldsOf(s.fields);
  const status = s.status as ModelSummaryView['status'];
  return {
    ...base,
    status,
    reason: s.reason,
    reasonText: modelSummaryReasonText(
      s.status as Exclude<ModelSummaryView['status'], 'none'>,
      s.reason as Parameters<typeof modelSummaryReasonText>[1],
    ),
    templateId: s.templateId,
    templateLabel: template?.label ?? null,
    mapProvisional: s.mapProvisional,
    extractedAt: s.extractedAt.toISOString(),
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      unit: f.unit,
      type: f.type,
      sheet: f.sheet,
      ref: f.ref,
      definedName: f.definedName,
      state: f.state,
      number: f.number,
      text: f.text,
      date: f.date ? f.date.toISOString().slice(0, 10) : null,
      headline: f.headline,
      proposed: f.proposed,
    })),
    warnings: modelSummaryWarnings(s.kind, fields, template),
  };
}
