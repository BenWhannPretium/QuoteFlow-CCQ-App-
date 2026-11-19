import { describe, expect, it } from 'vitest';

import {
  REQUOTE_COPIED_FIELDS,
  REQUOTE_NOT_COPIED_FIELDS,
  cerProofOk,
  linkedRequoteEligibility,
  parseCerLinkUrl,
  parseLinkedRequoteAllowedFrom,
  parseValidityNoticeRecipients,
  requoteBanner,
  requoteItems,
  requoteRequestFields,
  validityNoticeUserIds,
} from './requote';
import { derivedDecisionFields } from '../commercial/derived';
import { hybridConfig } from '../workflow/seeds/hybrid';

// 2026-11-19 15:00 UTC = 09:00 US Central: "today" is 2026-11-19.
const NOW = new Date('2026-11-19T15:00:00Z');
const BOTH = parseLinkedRequoteAllowedFrom(undefined);

const quote = (over: Partial<Parameters<typeof linkedRequoteEligibility>[0]> = {}) => ({
  stageKey: 'CUSTOMER_DECISION',
  status: 'active',
  validityUntil: '2026-11-18',
  requotedAsNumber: null,
  ...over,
});

describe('linked re-quote: who may start one from which state (FB-26, N17-30)', () => {
  it('starts from a quote closed as "No response / Expired"', () => {
    expect(
      linkedRequoteEligibility(quote({ stageKey: 'EXPIRED', status: 'closed' }), BOTH, NOW),
    ).toEqual({ ok: true, from: 'closed_expired' });
  });

  it('starts from a quote still open at Customer Decision whose validity has passed (records G5 first)', () => {
    expect(linkedRequoteEligibility(quote(), BOTH, NOW)).toEqual({ ok: true, from: 'open_lapsed' });
  });

  it('refuses while the offer is still valid (its last day included): the same-quote Re-quote applies', () => {
    for (const validityUntil of ['2026-11-19', '2026-12-01']) {
      const r = linkedRequoteEligibility(quote({ validityUntil }), BOTH, NOW);
      expect(r).toMatchObject({ ok: false, code: 'requote_not_allowed' });
      expect(!r.ok && r.message).toMatch(/still valid/);
    }
  });

  it('refuses a quote with no validity date, on hold, lost, awarded or declined', () => {
    const cases = [
      quote({ validityUntil: null }),
      quote({ status: 'on_hold' }),
      quote({ stageKey: 'CLOSED_LOST', status: 'closed' }),
      quote({ stageKey: 'COMMIT_HANDOFF', status: 'active' }),
      quote({ stageKey: 'DECLINED', status: 'closed' }),
    ];
    for (const c of cases) {
      expect(linkedRequoteEligibility(c, BOTH, NOW)).toMatchObject({
        ok: false,
        code: 'requote_not_allowed',
      });
    }
  });

  it('refuses a quote already re-quoted, naming the new quote', () => {
    const r = linkedRequoteEligibility(
      quote({ stageKey: 'EXPIRED', status: 'closed', requotedAsNumber: 'CCQ-2026-00042' }),
      BOTH,
      NOW,
    );
    expect(r).toEqual({
      ok: false,
      code: 'already_requoted',
      message: 'This quote was already re-quoted as CCQ-2026-00042',
    });
  });

  it('follows linked_requote_allowed_from: each state can be switched off', () => {
    const closed = quote({ stageKey: 'EXPIRED', status: 'closed' });
    expect(linkedRequoteEligibility(closed, ['open_lapsed'], NOW).ok).toBe(false);
    expect(linkedRequoteEligibility(quote(), ['closed_expired'], NOW).ok).toBe(false);
    expect(linkedRequoteEligibility(closed, [], NOW).ok).toBe(false);
  });

  it('parses the setting strictly (seed both; unknown or repeated states refused)', () => {
    expect(BOTH).toEqual(['closed_expired', 'open_lapsed']);
    expect(parseLinkedRequoteAllowedFrom([])).toEqual([]);
    expect(() => parseLinkedRequoteAllowedFrom(['lost'])).toThrow(/linked_requote_allowed_from/);
    expect(() => parseLinkedRequoteAllowedFrom(['open_lapsed', 'open_lapsed'])).toThrow();
    expect(() => parseLinkedRequoteAllowedFrom('closed_expired')).toThrow();
  });
});

describe('linked re-quote: what is copied (FB-26, N17-30)', () => {
  const old = {
    sfOpportunityId: '006000000000001AAA',
    sfOpportunityName: 'Synthetic opportunity',
    customer: { status: 'existing', sfAccountId: '001000000000001AAA', name: 'Acme Synthetic' },
    market: 'FOOD',
    subMarket: 'SAUCES',
    description: 'Three bottles',
    requestedPaymentTerms: 'NET30',
    toolingFundingModel: 'CUSTOMER',
    toolingCommitment: true,
    requestClass: 'CCQ',
    commentsForEngineering: 'Same as last time',
    shipTo: { city: 'Dallas', state: 'TX' },
    quoteNeededBy: '2026-10-01',
    separateQuoteConfirmed: true,
    // Not intake fields at all: never carried over.
    engineering: { plant: 'P1' },
    pricing: { price: 1.23 },
  };

  it('copies the request-level intake fields and nothing else', () => {
    const copied = requoteRequestFields(old);
    expect(copied).toEqual({
      sfOpportunityId: old.sfOpportunityId,
      sfOpportunityName: old.sfOpportunityName,
      customer: old.customer,
      market: 'FOOD',
      subMarket: 'SAUCES',
      description: 'Three bottles',
      requestedPaymentTerms: 'NET30',
      toolingFundingModel: 'CUSTOMER',
      toolingCommitment: true,
      requestClass: 'CCQ',
      commentsForEngineering: 'Same as last time',
      shipTo: { city: 'Dallas', state: 'TX' },
    });
    for (const key of REQUOTE_NOT_COPIED_FIELDS) expect(copied).not.toHaveProperty(key);
    expect(copied).not.toHaveProperty('engineering');
    expect(copied).not.toHaveProperty('pricing');
  });

  it('copied and not-copied fields do not overlap', () => {
    const copied = new Set<string>(REQUOTE_COPIED_FIELDS);
    for (const key of REQUOTE_NOT_COPIED_FIELDS) expect(copied.has(key)).toBe(false);
  });

  it('gives every item a new key and links it to the drawings the old item held or linked to', () => {
    let n = 0;
    const items = requoteItems(
      [
        {
          key: 'old-1',
          ownDrawingIds: ['d1'],
          linkedDrawingIds: [],
          fields: { key: 'old-1', label: 'Bottle A', resin: 'HDPE', duplicatedFrom: 'x' },
        },
        {
          key: 'old-2',
          ownDrawingIds: [],
          linkedDrawingIds: ['d1', 'd1'],
          fields: { key: 'old-2', label: 'Bottle B', linkedDrawingIds: ['d1'] },
        },
        { key: 'old-3', ownDrawingIds: [], linkedDrawingIds: [], fields: { key: 'old-3' } },
      ],
      () => `new-${++n}`,
    );
    expect(items).toEqual([
      { label: 'Bottle A', resin: 'HDPE', key: 'new-1', linkedDrawingIds: ['d1'] },
      { label: 'Bottle B', key: 'new-2', linkedDrawingIds: ['d1'] },
      { key: 'new-3' },
    ]);
  });

  it('says what it is at the top of the draft', () => {
    expect(requoteBanner('CCQ-2026-00007', '2026-11-18')).toBe(
      'Re-quote of CCQ-2026-00007 (expired 2026-11-18). Check every value; Engineering and Pricing will review it again.',
    );
    expect(requoteBanner('CCQ-2026-00007', null)).toMatch(/^Re-quote of CCQ-2026-00007\. Check/);
  });
});

describe('validity notice recipients (FB-26, N17-31)', () => {
  it('seeds the KAM and the sales leader who qualified it', () => {
    expect(parseValidityNoticeRecipients(undefined)).toEqual(['kam', 'g1_decider']);
    expect(parseValidityNoticeRecipients(['kam'])).toEqual(['kam']);
    expect(() => parseValidityNoticeRecipients(['everyone'])).toThrow(/validity_notice_recipients/);
    expect(() => parseValidityNoticeRecipients(['kam', 'kam'])).toThrow();
  });

  it('tells each person once, and no sales leader when G1 was not decided by a person', () => {
    const both = parseValidityNoticeRecipients(undefined);
    expect(validityNoticeUserIds({ kamUserId: 'k', g1DeciderId: 's' }, both)).toEqual(['k', 's']);
    expect(validityNoticeUserIds({ kamUserId: 'k', g1DeciderId: null }, both)).toEqual(['k']);
    expect(validityNoticeUserIds({ kamUserId: 'k', g1DeciderId: 'k' }, both)).toEqual(['k']);
    expect(validityNoticeUserIds({ kamUserId: 'k', g1DeciderId: 's' }, ['g1_decider'])).toEqual([
      's',
    ]);
    expect(validityNoticeUserIds({ kamUserId: 'k', g1DeciderId: 's' }, [])).toEqual([]);
  });
});

describe('the CER at hand-off (FB-26, N17-32)', () => {
  it('reads the CER links as empty or https only', () => {
    expect(parseCerLinkUrl('')).toBe('');
    expect(parseCerLinkUrl(undefined)).toBe('');
    expect(parseCerLinkUrl('  https://cer.example.test/apex  ')).toBe(
      'https://cer.example.test/apex',
    );
    expect(() => parseCerLinkUrl('http://cer.example.test')).toThrow(/https/);
    expect(() => parseCerLinkUrl('javascript:alert(1)', 'cer_template_url')).toThrow(
      /cer_template_url/,
    );
    expect(() => parseCerLinkUrl(42)).toThrow();
  });

  it('needs a proof only when the setting is on and the CER is Approved', () => {
    expect(cerProofOk({ required: false, cerStatus: 'approved', proofOnFile: false })).toBe(true);
    expect(cerProofOk({ required: true, cerStatus: 'approved', proofOnFile: false })).toBe(false);
    expect(cerProofOk({ required: true, cerStatus: 'approved', proofOnFile: true })).toBe(true);
    expect(cerProofOk({ required: true, cerStatus: 'not_required', proofOnFile: false })).toBe(
      true,
    );
    expect(cerProofOk({ required: true, cerStatus: null, proofOnFile: false })).toBe(true);
  });

  it('is a derived field G6 Advance reads (the seed rule)', () => {
    const advance = hybridConfig.outcomes.find((o) => o.gateKey === 'G6' && o.key === 'advance')!;
    expect(advance.requiredFields).toContainEqual({
      field: 'cer_proof_ok',
      op: 'equals',
      value: true,
    });
    const settings = {
      legalReviewTriggers: {
        newCustomer: false,
        nonstandardTerms: false,
        toolingCommitment: false,
      },
      passThrough: { enabled: false, thresholdUsd: 0 },
      g4RequiredChecks: [],
      roiRequiredWhen: { g2Outcomes: [], capitalLikely: false, fundingModels: [] },
    } as unknown as Parameters<typeof derivedDecisionFields>[1];
    const fields = { handoff_record: { cer_status: 'approved' }, cer_proof_on_file: false };
    expect(derivedDecisionFields(fields, settings).cer_proof_ok).toBe(true);
    expect(
      derivedDecisionFields(fields, { ...settings, cerProofRequired: true }).cer_proof_ok,
    ).toBe(false);
  });
});
