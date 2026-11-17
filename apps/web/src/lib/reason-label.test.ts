import type { PublicConfigResponse, QuoteDetail } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { decisionReasonLabel, plainWords } from './reason-label';

const outcome = (gateKey: string, key: string, reasonContext: string | null) => ({
  gateKey,
  key,
  label: key,
  helpText: null,
  requiresNote: true,
  requiresReasonCode: true,
  reasonContext,
  active: true,
  outcomeGroup: null,
  sort: 0,
  provisional: true,
});
const reason = (context: string, code: string, label: string) => ({
  context,
  code,
  label,
  requiresNote: false,
  sort: 0,
});

/** The public config lists active reason codes only. */
const config = {
  outcomes: [
    outcome('G1', 'rework', 'rework'),
    outcome('G1', 'stop', 'stop'),
    outcome('G5', 'requote', 'requote'),
    outcome('G1', 'advance', null),
  ],
  reasonCodes: [
    reason('rework', 'missing_information', 'Missing information'),
    reason('rework', 'other', 'Other'),
    reason('requote', 'other', 'Other (note required)'),
  ],
} as unknown as PublicConfigResponse;

const decision = (over: Partial<QuoteDetail['decisions'][number]> = {}) => ({
  gateKey: 'G1',
  outcomeKey: 'rework',
  reasonCode: 'missing_information' as string | null,
  decidedAt: '2026-11-12T21:04:00.000Z',
  ...over,
});

describe('decisionReasonLabel', () => {
  it('shows the configured label, not the stored key', () => {
    expect(decisionReasonLabel(config, decision())).toBe('Missing information');
  });

  it('reads the label in the reason context of the decision’s own outcome', () => {
    expect(decisionReasonLabel(config, decision({ reasonCode: 'other' }))).toBe('Other');
    expect(
      decisionReasonLabel(
        config,
        decision({ gateKey: 'G5', outcomeKey: 'requote', reasonCode: 'other' }),
      ),
    ).toBe('Other (note required)');
  });

  it('a decision with no reason has no label', () => {
    expect(
      decisionReasonLabel(config, decision({ outcomeKey: 'advance', reasonCode: null })),
    ).toBeNull();
  });

  it('a retired code keeps the label the quote carries for its send-back', () => {
    const d = decision({ reasonCode: 'retired_code' });
    const rework = {
      gateKey: 'G1',
      reasonCode: 'retired_code',
      reasonLabel: 'Drawing out of date',
      note: null,
      decidedAt: d.decidedAt,
      decidedByName: null,
    };
    expect(decisionReasonLabel(config, d, { rework })).toBe('Drawing out of date');
    // Another decision with the same code is not the send-back the quote describes.
    expect(
      decisionReasonLabel(config, { ...d, decidedAt: '2026-10-01T00:00:00.000Z' }, { rework }),
    ).toBe('Retired code');
  });

  it('a retired code keeps the label the quote carries for its closure', () => {
    const d = decision({ outcomeKey: 'stop', reasonCode: 'old_stop' });
    const closure = { gateKey: 'G1', reasonCode: 'old_stop', reasonLabel: 'No longer pursued' };
    expect(
      decisionReasonLabel(config, d, {
        customerDecision: { closure } as unknown as QuoteDetail['customerDecision'],
      }),
    ).toBe('No longer pursued');
  });

  it('with no label anywhere, the key is put in plain words (never shown raw)', () => {
    expect(decisionReasonLabel(config, decision({ reasonCode: 'price_change' }))).toBe(
      'Price change',
    );
    // Until the config has loaded.
    expect(decisionReasonLabel(undefined, decision())).toBe('Missing information');
    // The server's own fallback (the code as its label) is not passed off as a label.
    const d = decision({ reasonCode: 'retired_code' });
    const rework = {
      gateKey: 'G1',
      reasonCode: 'retired_code',
      reasonLabel: 'retired_code',
      note: null,
      decidedAt: d.decidedAt,
      decidedByName: null,
    };
    expect(decisionReasonLabel(config, d, { rework })).toBe('Retired code');
  });
});

describe('plainWords', () => {
  it('turns a stored key into words', () => {
    expect(plainWords('missing_information')).toBe('Missing information');
    expect(plainWords('awaiting-customer_info')).toBe('Awaiting customer info');
  });
});
