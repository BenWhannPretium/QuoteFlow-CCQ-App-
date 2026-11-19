import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * FB-29 (N19-01, N19-02; D-16w, F-035): the governed Salesforce write-back. Everything here is config
 * (rule 4), seeded `provisional: true` and switched off: what is written, and where, is not approved
 * until IT (Rachel) grants a write identity and the Salesforce owner approves the mapping.
 *
 * QuoteFlow stays complete without Salesforce (N19-02): nothing in a quote's workflow waits for a
 * write. A write is queued in the decision's own transaction and sent later by a worker.
 */

/** What can cause a write. */
export const SF_WRITEBACK_EVENTS = [
  /** A customer outcome recorded at Customer Decision (G5): the opportunity's stage. */
  'outcome_recorded',
  /** A linked re-quote started: reopens an opportunity QuoteFlow closed (expired, then re-quoted). */
  'requote_started',
  /** Any QuoteFlow stage change, through `stageMap` (seeded empty, so off). */
  'stage_changed',
  /** The QuoteFlow quote number or link into a custom field (no field named yet, so off). */
  'quote_link',
] as const;
export type SfWritebackEvent = (typeof SF_WRITEBACK_EVENTS)[number];

/** `sf_writeback_mode`: dry_run records what would be sent and sends nothing; live sends. */
export const SF_WRITEBACK_MODES = ['dry_run', 'live'] as const;
export type SfWritebackMode = (typeof SF_WRITEBACK_MODES)[number];

/** `sf_writeback_stage_regression`: never move an opportunity to an earlier stage (skip), or allow it. */
export const SF_WRITEBACK_REGRESSION_MODES = ['skip', 'allow'] as const;
export type SfWritebackRegressionMode = (typeof SF_WRITEBACK_REGRESSION_MODES)[number];

/** An outbox row's state. */
export const SF_WRITEBACK_STATUSES = ['pending', 'sent', 'failed', 'skipped', 'dry_run'] as const;
export type SfWritebackStatus = (typeof SF_WRITEBACK_STATUSES)[number];

/** Why a row was not written. A `skipped` row always means "QuoteFlow did not write this". */
export const SF_WRITEBACK_SKIP_REASONS = [
  /** A newer value for the same opportunity and field was queued; only the latest is sent. */
  'superseded',
  /** Salesforce holds a later stage; `sf_writeback_stage_regression` is skip. */
  'regression',
  /** A closing write while another quote or an open re-quote still needs the opportunity. */
  'other_active_quote',
  /** A reopen when QuoteFlow wrote nothing closing for the opportunity. */
  'nothing_to_reopen',
  /** A reopen when a sales person has since moved the opportunity off the stage QuoteFlow wrote. */
  'moved_in_salesforce',
  /** An Admin skipped it. */
  'admin_skip',
] as const;
export type SfWritebackSkipReason = (typeof SF_WRITEBACK_SKIP_REASONS)[number];

/** The one object QuoteFlow may write: never an Account (rule 7), never a create or delete. */
export const SF_WRITEBACK_OBJECTS = ['Opportunity'] as const;
export type SfWritebackObject = (typeof SF_WRITEBACK_OBJECTS)[number];

/** The Salesforce stage field: the regression and reopen checks read it before a write. */
export const SF_STAGE_FIELD = 'StageName';

/**
 * Figures are never written (fieldMap.test.ts bans mapping one; CLAUDE.md rule 5). This is checked on top
 * of the writer's allow-list, so a price field is refused even if someone added it there.
 */
export const SF_WRITEBACK_SENSITIVE_FIELD =
  /price|cost|margin|revenue|discount|capital|subtotal|amount/i;

/** Where an entry's value comes from. */
export const SfWritebackValueSource = z.discriminatedUnion('source', [
  /**
   * `sf_outcome_stage_names` (FB-04): the decided outcome's stage, or the fixed `key` (the reopen uses
   * `requote`).
   */
  z.object({
    source: z.literal('sf_outcome_stage_names'),
    key: z.string().trim().min(1).optional(),
  }),
  /** `stageMap` below: the QuoteFlow stage entered. */
  z.object({ source: z.literal('stage_map') }),
  /** The CCQ quote number (CCQ-YYYY-NNNNN). */
  z.object({ source: z.literal('quote_number') }),
  /** The quote's link in QuoteFlow (APP_BASE_URL + /quotes/<number>). */
  z.object({ source: z.literal('quote_url') }),
]);
export type SfWritebackValueSource = z.infer<typeof SfWritebackValueSource>;

const fieldName = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/, 'must be a Salesforce field API name');

export const SfWritebackMapEntry = z.object({
  event: z.enum(SF_WRITEBACK_EVENTS),
  enabled: z.boolean(),
  sfObject: z.enum(SF_WRITEBACK_OBJECTS),
  /** The field to write; null = not named yet (the entry stays off). */
  sfField: fieldName.nullable(),
  value: SfWritebackValueSource,
  /**
   * The source keys (outcome keys for outcome_recorded, QuoteFlow stage keys for stage_changed) whose
   * value closes the opportunity. A closing write is skipped while another quote needs the opportunity.
   */
  closing: z.array(z.string().trim().min(1)).default([]),
  /** A reopen (requote_started): exempt from the regression skip, sent only over QuoteFlow's own close. */
  reopens: z.boolean().default(false),
});
export type SfWritebackMapEntry = z.infer<typeof SfWritebackMapEntry>;

export const SfWritebackMap = z.object({
  entries: z.array(SfWritebackMapEntry),
  /** QuoteFlow stage key → Salesforce stage, for `stage_changed`. Seeded empty. */
  stageMap: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  /**
   * Salesforce stage → rank, for the regression check: a write whose stage ranks below the stage
   * Salesforce holds is a move backwards. A stage with no rank is never judged a regression.
   */
  stageRank: z.record(z.string().trim().min(1), z.number().int().min(0).max(10_000)).default({}),
});
export type SfWritebackMap = z.infer<typeof SfWritebackMap>;

/** The writer's allow-list (object → field API names), from `writeMap.ts` in the Salesforce connector. */
export type SfWriteAllowList = Readonly<Record<string, readonly string[]>>;

/**
 * Provisional seeds (rule 4). Ranks follow the org's stage list (`sf_stage_map`, read 2026-10-24); the
 * closed stages rank last, Closed Won above Closed Lost so a QuoteFlow loss never overwrites a won
 * opportunity. The stage names and ranks wait on the Salesforce owner.
 */
export const SF_WRITEBACK_MAP_SEED: SfWritebackMap = {
  entries: [
    {
      event: 'outcome_recorded',
      enabled: true,
      sfObject: 'Opportunity',
      sfField: SF_STAGE_FIELD,
      value: { source: 'sf_outcome_stage_names' },
      closing: ['lost', 'expired'],
      reopens: false,
    },
    {
      event: 'requote_started',
      enabled: true,
      sfObject: 'Opportunity',
      sfField: SF_STAGE_FIELD,
      value: { source: 'sf_outcome_stage_names', key: 'requote' },
      closing: [],
      reopens: true,
    },
    {
      event: 'stage_changed',
      enabled: false,
      sfObject: 'Opportunity',
      sfField: SF_STAGE_FIELD,
      value: { source: 'stage_map' },
      closing: [],
      reopens: false,
    },
    {
      event: 'quote_link',
      enabled: false,
      sfObject: 'Opportunity',
      sfField: null,
      value: { source: 'quote_number' },
      closing: [],
      reopens: false,
    },
  ],
  stageMap: {},
  stageRank: {
    Prospecting: 10,
    'Qualification / Needs Analysis': 20,
    Qualifying: 20,
    'RFP / Quote Entry - In Process': 30,
    Quoting: 30,
    Quoted: 40,
    'Final Review': 40,
    Negotiating: 50,
    'Negotiation / Customer Testing': 50,
    'Verbal Award': 60,
    'Verbal Award / Tool PO in Hand': 70,
    'PO(s) in hand': 70,
    'Closed Lost': 90,
    'Closed Won - Product Shipping': 100,
  },
};

export const SF_WRITEBACK_MAX_ATTEMPTS_SEED = 5;
/** Minutes to wait after the 1st, 2nd, … failed try (the last value repeats). */
export const SF_WRITEBACK_RETRY_MINUTES_SEED = [1, 5, 30, 120, 360] as const;

const bad = (key: string, m: string) => new DomainError('INVALID_CONFIG', `${key}: ${m}`);

/**
 * Validates `sf_writeback_map`. With `allowList` (the API passes the writer's), every named field must be
 * on it; without one (the settings console's own check) the shape and the figure ban still apply.
 * Throws INVALID_CONFIG.
 */
export function parseSfWritebackMap(value: unknown, allowList?: SfWriteAllowList): SfWritebackMap {
  const key = 'sf_writeback_map';
  const parsed = SfWritebackMap.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw bad(key, `${issue.path.join('.') || '(root)'} ${issue.message}`);
  }
  const map = parsed.data;
  const seen = new Set<string>();
  for (const e of map.entries) {
    if (seen.has(e.event)) throw bad(key, `${e.event} appears twice`);
    seen.add(e.event);
    if (e.sfField !== null && SF_WRITEBACK_SENSITIVE_FIELD.test(e.sfField)) {
      throw bad(key, `${e.event}: ${e.sfField} looks like a figure; QuoteFlow never writes one`);
    }
    if (e.sfField !== null && allowList && !(allowList[e.sfObject] ?? []).includes(e.sfField)) {
      throw bad(
        key,
        `${e.event}: ${e.sfObject}.${e.sfField} is not on the write allow-list (writeMap.ts)`,
      );
    }
    if (e.enabled && e.sfField === null) {
      throw bad(key, `${e.event} is switched on but names no Salesforce field`);
    }
    const source = e.value.source;
    const expected: Record<SfWritebackEvent, readonly string[]> = {
      outcome_recorded: ['sf_outcome_stage_names'],
      requote_started: ['sf_outcome_stage_names'],
      stage_changed: ['stage_map'],
      quote_link: ['quote_number', 'quote_url'],
    };
    if (!expected[e.event].includes(source)) {
      throw bad(key, `${e.event} cannot take its value from ${source}`);
    }
    if (e.event === 'requote_started') {
      if (e.value.source !== 'sf_outcome_stage_names' || !e.value.key) {
        throw bad(key, 'requote_started needs the sf_outcome_stage_names key it reopens to');
      }
      if (!e.reopens) throw bad(key, 'requote_started must be marked reopens');
      if (e.closing.length > 0) throw bad(key, 'requote_started cannot close the opportunity');
    } else if (e.reopens) {
      throw bad(key, `only requote_started reopens; ${e.event} cannot`);
    }
    if (e.event === 'stage_changed' && e.enabled && Object.keys(map.stageMap).length === 0) {
      throw bad(key, 'stage_changed is switched on but stageMap names no stage');
    }
  }
  return map;
}

export function parseSfWritebackEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw bad('sf_writeback_enabled', 'expected true or false');
  return value;
}

export function parseSfWritebackMode(value: unknown): SfWritebackMode {
  if (!SF_WRITEBACK_MODES.includes(value as SfWritebackMode)) {
    throw bad('sf_writeback_mode', `expected ${SF_WRITEBACK_MODES.join(' or ')}`);
  }
  return value as SfWritebackMode;
}

export function parseSfWritebackRegression(value: unknown): SfWritebackRegressionMode {
  if (!SF_WRITEBACK_REGRESSION_MODES.includes(value as SfWritebackRegressionMode)) {
    throw bad(
      'sf_writeback_stage_regression',
      `expected ${SF_WRITEBACK_REGRESSION_MODES.join(' or ')}`,
    );
  }
  return value as SfWritebackRegressionMode;
}

export function parseSfWritebackMaxAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20) {
    throw bad('sf_writeback_max_attempts', 'expected a whole number from 1 to 20');
  }
  return value;
}

export function parseSfWritebackRetryMinutes(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 20 ||
    !value.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_080)
  ) {
    throw bad(
      'sf_writeback_retry_minutes',
      'expected a list of 1 to 20 waits in whole minutes (1 to 10080)',
    );
  }
  return value as number[];
}

/** The settings the write-back reads, validated. Any invalid value is reported, never guessed. */
export interface SfWritebackSettings {
  enabled: boolean;
  mode: SfWritebackMode;
  map: SfWritebackMap;
  regression: SfWritebackRegressionMode;
  maxAttempts: number;
  retryMinutes: number[];
}

export type SfWritebackSettingsResult =
  { ok: true; settings: SfWritebackSettings } | { ok: false; error: string };

/**
 * Reads the six settings. A missing switch reads as off; anything else missing or invalid is an error
 * (the caller skips and audits; a decision is never refused because of it).
 */
export function parseSfWritebackSettings(
  raw: {
    enabled: unknown;
    mode: unknown;
    map: unknown;
    regression: unknown;
    maxAttempts: unknown;
    retryMinutes: unknown;
  },
  allowList?: SfWriteAllowList,
): SfWritebackSettingsResult {
  try {
    return {
      ok: true,
      settings: {
        enabled: raw.enabled === undefined ? false : parseSfWritebackEnabled(raw.enabled),
        mode: parseSfWritebackMode(raw.mode ?? 'dry_run'),
        map: parseSfWritebackMap(raw.map, allowList),
        regression: parseSfWritebackRegression(raw.regression ?? 'skip'),
        maxAttempts: parseSfWritebackMaxAttempts(raw.maxAttempts ?? SF_WRITEBACK_MAX_ATTEMPTS_SEED),
        retryMinutes: parseSfWritebackRetryMinutes(
          raw.retryMinutes ?? [...SF_WRITEBACK_RETRY_MINUTES_SEED],
        ),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid write-back settings' };
  }
}
