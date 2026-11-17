import { describe, expect, it } from 'vitest';

import { decisionLabel, forwardReadiness, otherDecisionsLabel } from './decision-label';

const action = (
  gateKey: string,
  outcomeKey: string,
  missing: string[] = [],
  outcomeGroup?: string | null,
) => ({
  gateKey,
  outcomeKey,
  ...(outcomeGroup !== undefined ? { outcomeGroup } : {}),
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
        action('G2', 'proceed_with_risk', ['cavitation', 'prelim_capital_usd']),
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
      [action('G2', 'proceed'), action('G2', 'proceed_with_risk', ['prelim_capital_usd'])],
      'G2',
    );
    expect(r.ready).toBe(true);
  });

  it('FB-17: reads forward from the outcome group when the action carries one, not from its key', () => {
    const r = forwardReadiness(
      [
        action('G2', 'proceed', ['prelim_capital_usd'], 'advance'),
        // An outcome an Admin added later moves forward too, because its group says so.
        action('G2', 'proceed_pilot', [], 'advance'),
        action('G2', 'hold', [], 'hold'),
        action('G2', 'rework', [], 'send_back'),
        action('G2', 'redirect', [], 'send_back'),
        action('G2', 'stop', [], 'stop'),
      ],
      'G2',
    );
    expect(r.ready).toBe(true);
    expect(r.missing.map((m) => m.field)).toEqual(['prelim_capital_usd']);
    expect(r.others).toEqual(['hold', 'rework', 'redirect', 'stop']);
    // A key that used to mean "forward" does not, once its group says otherwise.
    const regrouped = forwardReadiness([action('G3', 'submit', [], 'hold')], 'G3');
    expect(regrouped).toEqual({ ready: false, missing: [], others: ['submit'] });
  });

  it('a retired key without a group still counts as forward (a config from before FB-17)', () => {
    const r = forwardReadiness([action('G2', 'capital_required', ['equipment_bom_on_file'])], 'G2');
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.field)).toEqual(['equipment_bom_on_file']);
    expect(r.others).toEqual([]);
  });

  it('never holds back a gate that has no work tab', () => {
    expect(forwardReadiness([action('G1', 'advance', ['x'])], 'G1').ready).toBe(true);
  });
});

describe('otherDecisionsLabel', () => {
  it('does not offer Hold by name on a quote that is already on hold', () => {
    expect(otherDecisionsLabel(false)).toBe('Send back, hold or stop');
    expect(otherDecisionsLabel(true)).toBe('Send back or stop');
  });
});
