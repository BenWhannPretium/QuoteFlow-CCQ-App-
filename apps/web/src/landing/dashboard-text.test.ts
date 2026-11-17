import { describe, expect, it } from 'vitest';

import { STAGE_AMOUNT_WORDS, captureHint, gateLabel, returnedAt } from './dashboard-text';

describe('Command Center wording (UX-013)', () => {
  it('spells Salesforce out on the stage totals', () => {
    expect(STAGE_AMOUNT_WORDS).toBe('Salesforce opportunity amount');
    expect(STAGE_AMOUNT_WORDS).not.toMatch(/\bSF\b/);
  });

  describe('captureHint', () => {
    it('says "past validity with no outcome recorded", not "gone dark"', () => {
      const text = captureHint({ recorded: 13, goneDark: 5, awaiting: 0 });
      expect(text).toBe('13 recorded, 5 past validity with no outcome recorded, 0 still waiting.');
      expect(text).not.toContain('gone dark');
    });

    it('groups thousands', () => {
      expect(captureHint({ recorded: 1200, goneDark: 1, awaiting: 30 })).toBe(
        '1,200 recorded, 1 past validity with no outcome recorded, 30 still waiting.',
      );
    });

    it('says there is nothing to measure before any proposal is past validity', () => {
      expect(captureHint({ recorded: 0, goneDark: 0, awaiting: 4 })).toBe(
        'No proposals are past their validity yet, so there is nothing to measure.',
      );
    });
  });

  describe('gateLabel', () => {
    const config = {
      gates: [
        {
          key: 'G1',
          stageKey: 'INTAKE',
          label: 'Qualify & prioritize',
          helpText: null,
          deciderPermission: 'gate.G1.decide',
          enabled: true,
          sort: 1,
          provisional: true,
        },
      ],
    };

    it('is the configured label of the gate', () => {
      expect(gateLabel(config, 'G1')).toBe('Qualify & prioritize');
    });

    it('is null, never the gate number, when the label is not known', () => {
      expect(gateLabel(undefined, 'G1')).toBeNull();
      expect(gateLabel(config, 'G2')).toBeNull();
      expect(gateLabel(config, null)).toBeNull();
    });

    it('returnedAt puts the label after the words given, or says nothing', () => {
      expect(returnedAt(config, 'G1', ' · returned at ')).toBe(
        ' · returned at Qualify & prioritize',
      );
      expect(returnedAt(config, 'G1', 'Returned at ')).toBe('Returned at Qualify & prioritize');
      expect(returnedAt(undefined, 'G1', 'Returned at ')).toBe('');
      expect(returnedAt(config, 'G9', 'Returned at ')).toBe('');
    });
  });
});
