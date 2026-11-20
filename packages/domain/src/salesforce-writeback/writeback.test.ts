import { describe, expect, it } from 'vitest';

import {
  SF_WRITEBACK_MAP_SEED,
  parseSfWritebackMap,
  parseSfWritebackMode,
  parseSfWritebackRetryMinutes,
  parseSfWritebackSettings,
  type SfWritebackMap,
} from './config';
import {
  decideSend,
  isStageRegression,
  latestPerField,
  planDecisionWrites,
  planRequoteWrite,
  sfWritebackRetryDelayMs,
  truncateSfError,
} from './plan';
import { SF_OUTCOME_STAGE_NAMES_SEED } from '../outcome/sf-stage';

const ALLOW = { Opportunity: ['StageName', 'CCQ_Quote_Number__c'] } as const;
const clone = (): SfWritebackMap => structuredClone(SF_WRITEBACK_MAP_SEED);
const subject = {
  quoteId: '019a0000-0000-7000-8000-000000000001',
  quoteNumber: 'CCQ-2026-00042',
  sfOpportunityId: '006000000000001AAA',
  quoteUrl: 'https://ccq.example.test/quotes/CCQ-2026-00042',
};
const entry = (map: SfWritebackMap, event: string) => map.entries.find((e) => e.event === event)!;

describe('sf_writeback_map validation', () => {
  it('accepts the seed, with and without the allow-list', () => {
    expect(parseSfWritebackMap(SF_WRITEBACK_MAP_SEED)).toEqual(SF_WRITEBACK_MAP_SEED);
    expect(parseSfWritebackMap(SF_WRITEBACK_MAP_SEED, ALLOW)).toEqual(SF_WRITEBACK_MAP_SEED);
  });

  it('rejects a field that is not on the write allow-list', () => {
    const map = clone();
    entry(map, 'quote_link').sfField = 'Quote_Number_Typo__c';
    expect(() => parseSfWritebackMap(map, ALLOW)).toThrow(/not on the write allow-list/);
  });

  it('rejects a price, cost, margin or capital field even when it is allow-listed', () => {
    for (const field of [
      'Piece_Part_Price__c',
      'Amount',
      'Capital_Estimate__c',
      'Gross_Margin__c',
    ]) {
      const map = clone();
      entry(map, 'quote_link').sfField = field;
      expect(() => parseSfWritebackMap(map, { Opportunity: ['StageName', field] }), field).toThrow(
        /figure/,
      );
    }
  });

  it('rejects a switched-on entry with no target field', () => {
    const map = clone();
    const link = entry(map, 'quote_link');
    link.enabled = true;
    expect(link.sfField).toBeNull();
    expect(() => parseSfWritebackMap(map)).toThrow(/names no Salesforce field/);
  });

  it('rejects stage_changed switched on with an empty stage map, an object other than Opportunity, and duplicates', () => {
    const stage = clone();
    entry(stage, 'stage_changed').enabled = true;
    expect(() => parseSfWritebackMap(stage)).toThrow(/stageMap names no stage/);
    const account = clone() as unknown as { entries: { sfObject: string }[] };
    account.entries[0]!.sfObject = 'Account';
    expect(() => parseSfWritebackMap(account)).toThrow(/sfObject/);
    const dup = clone();
    dup.entries.push({ ...dup.entries[0]! });
    expect(() => parseSfWritebackMap(dup)).toThrow(/twice/);
  });

  it('only requote_started reopens, and it needs its stage key', () => {
    const a = clone();
    entry(a, 'outcome_recorded').reopens = true;
    expect(() => parseSfWritebackMap(a)).toThrow(/only requote_started reopens/);
    const b = clone();
    entry(b, 'requote_started').value = { source: 'sf_outcome_stage_names' };
    expect(() => parseSfWritebackMap(b)).toThrow(/key it reopens to/);
  });

  it('the settings bundle reads a missing switch as off and reports an invalid value', () => {
    const ok = parseSfWritebackSettings({
      enabled: undefined,
      mode: undefined,
      map: SF_WRITEBACK_MAP_SEED,
      regression: undefined,
      maxAttempts: undefined,
      retryMinutes: undefined,
    });
    expect(ok).toMatchObject({
      ok: true,
      settings: { enabled: false, mode: 'dry_run', maxAttempts: 5 },
    });
    const bad = parseSfWritebackSettings({
      enabled: true,
      mode: 'turbo',
      map: SF_WRITEBACK_MAP_SEED,
      regression: 'skip',
      maxAttempts: 5,
      retryMinutes: [1],
    });
    expect(bad).toEqual({ ok: false, error: expect.stringMatching(/sf_writeback_mode/) as string });
    expect(() => parseSfWritebackMode('live')).not.toThrow();
    expect(() => parseSfWritebackRetryMinutes([])).toThrow();
  });
});

describe('planning a decision’s writes', () => {
  const plan = (over: Partial<Parameters<typeof planDecisionWrites>[0]> = {}) =>
    planDecisionWrites({
      map: SF_WRITEBACK_MAP_SEED,
      outcomeNames: SF_OUTCOME_STAGE_NAMES_SEED,
      subject,
      gateStageKey: 'CUSTOMER_DECISION',
      outcomeKey: 'lost',
      enteredStageKey: 'CLOSED_LOST',
      decisionId: 'decision-1',
      ...over,
    });

  it('a G5 loss writes Closed Lost, closing, with the payload that would be sent', () => {
    expect(plan()).toEqual([
      {
        event: 'outcome_recorded',
        sfObject: 'Opportunity',
        sfField: 'StageName',
        value: 'Closed Lost',
        closing: true,
        reopens: false,
        dedupeKey: `${subject.quoteId}:outcome_recorded:Closed Lost:decision-1`,
        payload: JSON.stringify({
          object: 'Opportunity',
          id: subject.sfOpportunityId,
          fields: { StageName: 'Closed Lost' },
        }),
      },
    ]);
    expect(plan({ outcomeKey: 'expired' })[0]).toMatchObject({
      value: 'Closed Lost',
      closing: true,
    });
    expect(plan({ outcomeKey: 'awarded' })[0]).toMatchObject({
      value: 'Verbal Award',
      closing: false,
    });
  });

  it('writes nothing outside Customer Decision: G6 has a requote outcome too', () => {
    expect(plan({ gateStageKey: 'COMMIT_HANDOFF', outcomeKey: 'requote' })).toEqual([]);
    expect(plan({ gateStageKey: 'COMMIT_HANDOFF', outcomeKey: 'advance' })).toEqual([]);
  });

  it('writes nothing for an outcome with no configured stage, or when the entry is off', () => {
    expect(plan({ outcomeKey: 'hold' })).toEqual([]);
    const off = clone();
    entry(off, 'outcome_recorded').enabled = false;
    expect(plan({ map: off })).toEqual([]);
  });

  it('stage_changed and quote_link follow the map; the outcome wins a shared field', () => {
    const map = clone();
    map.stageMap = { FINAL_REVIEW: 'Final Review', CLOSED_LOST: 'Closed Lost' };
    entry(map, 'stage_changed').enabled = true;
    const link = entry(map, 'quote_link');
    link.enabled = true;
    link.sfField = 'CCQ_Quote_Number__c';
    expect(
      plan({ map, gateStageKey: 'FINAL_REVIEW', enteredStageKey: 'FINAL_REVIEW' }).map((w) => [
        w.event,
        w.value,
        w.dedupeKey,
      ]),
    ).toEqual([
      ['stage_changed', 'Final Review', `${subject.quoteId}:stage_changed:Final Review:decision-1`],
      ['quote_link', 'CCQ-2026-00042', `${subject.quoteId}:quote_link:CCQ-2026-00042:once`],
    ]);
    expect(plan({ map }).map((w) => w.event)).toEqual(['outcome_recorded', 'quote_link']);
  });

  it('a re-quote plans the reopen to the requote stage', () => {
    expect(
      planRequoteWrite({
        map: SF_WRITEBACK_MAP_SEED,
        outcomeNames: SF_OUTCOME_STAGE_NAMES_SEED,
        subject,
        draftId: 'draft-1',
      }),
    ).toMatchObject({ event: 'requote_started', value: 'Quoting', reopens: true, closing: false });
  });
});

describe('the worker’s decisions', () => {
  const rank = SF_WRITEBACK_MAP_SEED.stageRank;
  const send = (over: Partial<Parameters<typeof decideSend>[0]>) =>
    decideSend({
      row: { sfField: 'StageName', value: 'Closed Lost', reopens: false },
      current: 'Negotiating',
      regression: 'skip',
      stageRank: rank,
      lastClosingWritten: null,
      ...over,
    });

  it('a regression is skipped under skip and sent under allow', () => {
    expect(isStageRegression('Closed Won - Product Shipping', 'Closed Lost', rank)).toBe(true);
    expect(isStageRegression('Negotiating', 'Closed Lost', rank)).toBe(false);
    expect(isStageRegression('Some New Stage', 'Closed Lost', rank)).toBe(false);
    expect(send({ current: 'Closed Won - Product Shipping' })).toEqual({
      action: 'skip',
      reason: 'regression',
    });
    expect(send({ current: 'Closed Won - Product Shipping', regression: 'allow' })).toEqual({
      action: 'send',
    });
    expect(send({})).toEqual({ action: 'send' });
  });

  it('a value Salesforce already holds is confirmed, not skipped (a retry after a timeout)', () => {
    expect(send({ current: 'Closed Lost' })).toEqual({ action: 'confirmed_existing' });
    expect(
      send({
        row: { sfField: 'StageName', value: 'Quoting', reopens: true },
        current: 'Quoting',
        lastClosingWritten: null,
      }),
    ).toEqual({ action: 'confirmed_existing' });
  });

  it('a reopen goes only over the close QuoteFlow wrote, and is exempt from the regression skip', () => {
    const reopen = { sfField: 'StageName', value: 'Quoting', reopens: true };
    expect(
      send({ row: reopen, current: 'Closed Lost', lastClosingWritten: 'Closed Lost' }),
    ).toEqual({
      action: 'send',
    });
    expect(send({ row: reopen, current: 'Closed Lost', lastClosingWritten: null })).toEqual({
      action: 'skip',
      reason: 'nothing_to_reopen',
    });
    expect(
      send({ row: reopen, current: 'Negotiating', lastClosingWritten: 'Closed Lost' }),
    ).toEqual({
      action: 'skip',
      reason: 'moved_in_salesforce',
    });
  });

  it('only the latest value per opportunity and field is sent; the older are superseded', () => {
    const t = (s: number) => new Date(Date.UTC(2026, 10, 19, 12, 0, s));
    const row = (id: string, at: Date, field = 'StageName', opp = 'A') => ({
      id,
      sfOpportunityId: opp,
      sfObject: 'Opportunity',
      sfField: field,
      createdAt: at,
    });
    const rows = [
      row('1', t(1)),
      row('3', t(3)),
      row('2', t(2)),
      row('4', t(1), 'CCQ_Quote_Number__c'),
      row('5', t(0), 'StageName', 'B'),
    ];
    const { send: out, superseded } = latestPerField(rows);
    expect(out.map((r) => r.id).sort()).toEqual(['3', '4', '5']);
    expect(superseded.map((r) => r.id).sort()).toEqual(['1', '2']);
  });

  it('backs off 1, 5, 30, 120, 360 minutes and stops at the maximum', () => {
    const minutes = [1, 5, 30, 120, 360];
    expect([1, 2, 3, 4].map((a) => sfWritebackRetryDelayMs(a, 5, minutes)! / 60_000)).toEqual([
      1, 5, 30, 120,
    ]);
    expect(sfWritebackRetryDelayMs(5, 5, minutes)).toBeNull();
    expect(sfWritebackRetryDelayMs(6, 10, [1, 5])).toBe(5 * 60_000);
  });

  it('keeps a stored error under 500 characters', () => {
    expect(truncateSfError('x'.repeat(900))).toHaveLength(500);
    expect(truncateSfError(' A \n B ')).toBe('A B');
  });
});
