import {
  SF_STAGE_FIELD,
  type SfWritebackEvent,
  type SfWritebackMap,
  type SfWritebackMapEntry,
  type SfWritebackRegressionMode,
  type SfWritebackSkipReason,
} from './config';
import { CUSTOMER_DECISION_STAGE_KEY } from '../final-review/release';
import { sfStageForOutcome } from '../outcome/sf-stage';

/**
 * FB-29: what a QuoteFlow event would write to Salesforce, worked out from the map alone. Pure: the API
 * adds the checks that need the database (another quote on the opportunity, what was already sent) and
 * the worker adds the ones that need Salesforce (the stage it holds now).
 */

export interface PlannedSfWrite {
  event: SfWritebackEvent;
  sfObject: string;
  sfField: string;
  value: string;
  /** This write closes the opportunity (skipped while another quote still needs it). */
  closing: boolean;
  /** This write reopens an opportunity QuoteFlow closed. */
  reopens: boolean;
  /** Local only (Salesforce's REST update has no idempotency key): quote, event, value, source id. */
  dedupeKey: string;
  /** The JSON that would be sent, as stored on the outbox row and shown in the preview. */
  payload: string;
}

export interface SfWriteSubject {
  quoteId: string;
  quoteNumber: string;
  sfOpportunityId: string;
  /** The quote's link in QuoteFlow, for `quote_url`. */
  quoteUrl: string;
}

const entryFor = (map: SfWritebackMap, event: SfWritebackEvent): SfWritebackMapEntry | undefined =>
  map.entries.find((e) => e.event === event && e.enabled && e.sfField !== null);

export function sfWritePayload(
  sfObject: string,
  sfOpportunityId: string,
  sfField: string,
  value: string,
): string {
  return JSON.stringify({ object: sfObject, id: sfOpportunityId, fields: { [sfField]: value } });
}

function planned(
  entry: SfWritebackMapEntry,
  subject: SfWriteSubject,
  value: string,
  sourceKey: string | null,
  sourceId: string,
): PlannedSfWrite {
  const field = entry.sfField!;
  return {
    event: entry.event,
    sfObject: entry.sfObject,
    sfField: field,
    value,
    closing: sourceKey !== null && entry.closing.includes(sourceKey),
    reopens: entry.reopens,
    dedupeKey: `${subject.quoteId}:${entry.event}:${value}:${sourceId}`,
    payload: sfWritePayload(entry.sfObject, subject.sfOpportunityId, field, value),
  };
}

function valueFor(
  entry: SfWritebackMapEntry,
  subject: SfWriteSubject,
  ctx: { outcomeKey?: string; stageKey?: string; outcomeNames: Readonly<Record<string, string>> },
  map: SfWritebackMap,
): { value: string; sourceKey: string | null } | null {
  const v = entry.value;
  switch (v.source) {
    case 'sf_outcome_stage_names': {
      const key = v.key ?? ctx.outcomeKey;
      if (!key) return null;
      const stage = sfStageForOutcome(key, ctx.outcomeNames);
      return stage ? { value: stage, sourceKey: key } : null;
    }
    case 'stage_map': {
      const stage = ctx.stageKey ? map.stageMap[ctx.stageKey] : undefined;
      return stage ? { value: stage, sourceKey: ctx.stageKey! } : null;
    }
    case 'quote_number':
      return { value: subject.quoteNumber, sourceKey: null };
    case 'quote_url':
      return { value: subject.quoteUrl, sourceKey: null };
  }
}

/**
 * The writes a gate decision causes. `outcome_recorded` only at Customer Decision (G5): the outcome
 * names are keyed by the bare outcome key and G6 also has a `requote` outcome that would otherwise map
 * to "Quoting"; G6's advance and stop have no seeded stage, so they write nothing. `stage_changed` when
 * the decision enters a stage `stageMap` names. `quote_link` once per quote (its key has no decision).
 */
export function planDecisionWrites(input: {
  map: SfWritebackMap;
  outcomeNames: Readonly<Record<string, string>>;
  subject: SfWriteSubject;
  gateStageKey: string;
  outcomeKey: string;
  /** The stage the decision enters; null when it stays (a hold). */
  enteredStageKey: string | null;
  decisionId: string;
}): PlannedSfWrite[] {
  const { map, subject } = input;
  const out: PlannedSfWrite[] = [];
  const outcome = entryFor(map, 'outcome_recorded');
  if (outcome && input.gateStageKey === CUSTOMER_DECISION_STAGE_KEY) {
    const v = valueFor(
      outcome,
      subject,
      { outcomeKey: input.outcomeKey, outcomeNames: input.outcomeNames },
      map,
    );
    if (v) out.push(planned(outcome, subject, v.value, v.sourceKey, input.decisionId));
  }
  const stage = entryFor(map, 'stage_changed');
  if (stage && input.enteredStageKey) {
    const v = valueFor(
      stage,
      subject,
      { stageKey: input.enteredStageKey, outcomeNames: input.outcomeNames },
      map,
    );
    if (v) out.push(planned(stage, subject, v.value, v.sourceKey, input.decisionId));
  }
  const link = entryFor(map, 'quote_link');
  if (link) {
    const v = valueFor(link, subject, { outcomeNames: input.outcomeNames }, map);
    if (v) out.push(planned(link, subject, v.value, null, 'once'));
  }
  // Two entries on one field (an outcome and a stage change both on StageName): the outcome wins.
  return out.filter(
    (w, i) => out.findIndex((o) => o.sfObject === w.sfObject && o.sfField === w.sfField) === i,
  );
}

/** The reopen a linked re-quote causes; null when the entry is off or `sf_outcome_stage_names` lacks it. */
export function planRequoteWrite(input: {
  map: SfWritebackMap;
  outcomeNames: Readonly<Record<string, string>>;
  subject: SfWriteSubject;
  draftId: string;
}): PlannedSfWrite | null {
  const entry = entryFor(input.map, 'requote_started');
  if (!entry) return null;
  const v = valueFor(entry, input.subject, { outcomeNames: input.outcomeNames }, input.map);
  return v ? planned(entry, input.subject, v.value, null, input.draftId) : null;
}

// ── The worker's decisions ────────────────────────────────────────────────────────────────────────

/** True when writing `target` would move the opportunity to an earlier stage than `current`. */
export function isStageRegression(
  current: string | null,
  target: string,
  stageRank: Readonly<Record<string, number>>,
): boolean {
  if (current === null || current === target) return false;
  const from = stageRank[current];
  const to = stageRank[target];
  return from !== undefined && to !== undefined && to < from;
}

export type SendDecision =
  | { action: 'send' }
  /** Salesforce already holds the value (a retry after a timeout that reached it): `sent`, not skipped. */
  | { action: 'confirmed_existing' }
  | { action: 'skip'; reason: SfWritebackSkipReason };

/**
 * Whether to send a due row, given the stage Salesforce holds now (`current`, read through the writer's
 * own session; `undefined` when the row is not a stage write and nothing was read).
 *
 *   1. Salesforce already holds this value → confirmed_existing (counts as written by QuoteFlow).
 *   2. A reopen → only over the closed stage QuoteFlow itself last wrote: none → nothing_to_reopen;
 *      Salesforce moved on since → moved_in_salesforce. A reopen is exempt from the regression skip.
 *   3. Otherwise, with regression = skip, a move to an earlier stage → regression.
 */
export function decideSend(input: {
  row: { sfField: string; value: string; reopens: boolean };
  current: string | null | undefined;
  regression: SfWritebackRegressionMode;
  stageRank: Readonly<Record<string, number>>;
  /** The closing value of QuoteFlow's latest written stage on this opportunity; null if not closing. */
  lastClosingWritten: string | null;
}): SendDecision {
  const { row, current } = input;
  if (current !== undefined && current === row.value) return { action: 'confirmed_existing' };
  if (row.reopens) {
    if (input.lastClosingWritten === null) return { action: 'skip', reason: 'nothing_to_reopen' };
    if (current !== undefined && current !== input.lastClosingWritten) {
      return { action: 'skip', reason: 'moved_in_salesforce' };
    }
    return { action: 'send' };
  }
  if (
    row.sfField === SF_STAGE_FIELD &&
    current !== undefined &&
    input.regression === 'skip' &&
    isStageRegression(current, row.value, input.stageRank)
  ) {
    return { action: 'skip', reason: 'regression' };
  }
  return { action: 'send' };
}

/**
 * Of the due rows, the one to send per opportunity and field (the latest; the older are superseded).
 * Rows are compared by `createdAt`, then `id` (UUID v7, so time-ordered).
 */
export function latestPerField<
  T extends {
    id: string;
    sfOpportunityId: string;
    sfObject: string;
    sfField: string;
    createdAt: Date;
  },
>(rows: readonly T[]): { send: T[]; superseded: T[] } {
  const latest = new Map<string, T>();
  const keyOf = (r: T) => `${r.sfOpportunityId}|${r.sfObject}|${r.sfField}`;
  const newer = (a: T, b: T) =>
    a.createdAt.getTime() !== b.createdAt.getTime()
      ? a.createdAt.getTime() > b.createdAt.getTime()
      : a.id > b.id;
  for (const r of rows) {
    const k = keyOf(r);
    const cur = latest.get(k);
    if (!cur || newer(r, cur)) latest.set(k, r);
  }
  const send = [...latest.values()];
  const keep = new Set(send.map((r) => r.id));
  return { send, superseded: rows.filter((r) => !keep.has(r.id)) };
}

/** Wait before the next try after `attempts` failed ones, or null when the tries are used up. */
export function sfWritebackRetryDelayMs(
  attempts: number,
  maxAttempts: number,
  retryMinutes: readonly number[],
): number | null {
  if (attempts >= maxAttempts || retryMinutes.length === 0) return null;
  const minutes = retryMinutes[Math.min(Math.max(attempts - 1, 0), retryMinutes.length - 1)]!;
  return minutes * 60_000;
}

/** A stored error: short, and never more than 500 characters (no tokens: the writer passes codes). */
export function truncateSfError(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length <= 500 ? flat : `${flat.slice(0, 497)}...`;
}
