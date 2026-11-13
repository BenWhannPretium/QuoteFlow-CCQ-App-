import { describe, expect, it } from 'vitest';

import { decisionLabel, forwardReadiness } from './decision-label';

const action = (gateKey: string, outcomeKey: string, missing: string[] = []) => ({
  gateKey,
  outcomeKey,
  missing: missing.map((field) => ({ field, message: `${field} is required` })),
});

describe('decisionLabel', () => {
  it('names what the button does, and falls back for a gate added in config', () => {
    expect(decisionLabel('G2', 'Feasible solution?')).toBe('Decide feasibility');
    expect(decisionLabel('G9', 'Legal sign-off')).toBe('Decide: Legal sign-off');
  });
});

describe('forwardReadiness', () => {
  it('is not ready while every forward outcome is missing something, and says what the main one needs', () => {
    const r = forwardReadiness(
      [
        action('G2', 'proceed', ['cavitation']),
        action('G2', 'capital_required', ['prelim_capital_usd']),
        action('G2', 'hold'),
        action('G2', 'rework'),
      ],
      'G2',
    );
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.field)).toEqual(['cavitation']);
    expect(r.others).toEqual(['hold', 'rework']);
  });

  it('is ready as soon as one forward outcome has nothing missing', () => {
    const r = forwardReadiness(
      [action('G2', 'proceed'), action('G2', 'capital_required', ['prelim_capital_usd'])],
      'G2',
    );
    expect(r.ready).toBe(true);
  });

  it('never holds back a gate that has no work tab', () => {
    expect(forwardReadiness([action('G1', 'advance', ['x'])], 'G1').ready).toBe(true);
  });
});
