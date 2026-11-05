import { describe, expect, it } from 'vitest';

import { evaluateTransition } from './evaluate';
import { NOW, makeActor, makeQuote, validCase } from '../test-utils';
import { hybridConfig } from './seeds/hybrid';
import type { Role } from '../types/roles';

/**
 * FB-01 (F-027, Graham Parle and Bailey Schmitt; D-015 "notes are for exceptions only"): Advance with
 * risk, Capital required, Hold, Rework, Redirect and Stop all require a note, at every gate where they
 * exist. A plain Advance, Approve or Awarded does not. `evaluate.ts` enforces `requiresNote`.
 */
const EXCEPTIONS: Record<string, string[]> = {
  G1: ['hold', 'rework', 'redirect', 'stop'],
  G2: ['proceed_with_risk', 'capital_required', 'hold', 'rework', 'redirect', 'stop'],
  G3: ['hold', 'recost', 'rework', 'rework_kam', 'redirect', 'stop'],
  G4: ['hold', 'return', 'decline'],
  G5: ['negotiating', 'on_hold', 'requote'],
  G6: ['hold', 'requote', 'stop'],
};
/** Not exceptions: no note required (Lost / Expired keep their reason-code rule, `lost:other` etc.). */
const PLAIN: Record<string, string[]> = {
  G1: ['advance'],
  SUBMIT: ['submit'],
  G2: ['proceed'],
  G3: ['submit'],
  G4: ['approve'],
  G5: ['awarded', 'lost', 'expired'],
  G6: ['advance'],
};

const DECIDER: Record<string, Role[]> = {
  G1: ['SalesLeader'],
  SUBMIT: ['KAM'],
  G2: ['EngLead'],
  G3: ['PricingLead'],
  G4: ['Approver'],
  G5: ['SalesLeader'],
  G6: ['SalesLeader'],
};

const outcome = (g: string, o: string) =>
  hybridConfig.outcomes.find((x) => x.gateKey === g && x.key === o)!;

describe('every outcome of every gate is classified', () => {
  it('exceptions + plain outcomes = the seeded outcomes', () => {
    const all = hybridConfig.outcomes.map((o) => `${o.gateKey}/${o.key}`).sort();
    const listed = [...Object.entries(EXCEPTIONS), ...Object.entries(PLAIN)]
      .flatMap(([g, os]) => os.map((o) => `${g}/${o}`))
      .sort();
    expect(listed).toEqual(all);
  });
});

for (const [gateKey, keys] of Object.entries(EXCEPTIONS)) {
  describe(`${gateKey}: exception decisions need a note`, () => {
    const gate = hybridConfig.gates.find((g) => g.key === gateKey)!;
    for (const key of keys) {
      it(`${key} (${outcome(gateKey, key).label})`, () => {
        expect(outcome(gateKey, key).requiresNote).toBe(true);
        const c = validCase(hybridConfig, gateKey, key);
        const actor = makeActor(DECIDER[gateKey]!, { userId: 'user-decider' as never });
        const quote = makeQuote(gate.stageKey, { fields: c.fields });
        const { note: _note, ...withoutNote } = c.request;
        const missing = evaluateTransition(hybridConfig, quote, actor, withoutNote, NOW);
        expect(!missing.ok && missing.errors.map((e) => e.code)).toContain('NOTE_REQUIRED');
        const blank = evaluateTransition(
          hybridConfig,
          quote,
          actor,
          { ...c.request, note: '  ' },
          NOW,
        );
        expect(!blank.ok && blank.errors.map((e) => e.code)).toContain('NOTE_REQUIRED');
        expect(evaluateTransition(hybridConfig, quote, actor, c.request, NOW).ok).toBe(true);
      });
    }
  });
}

describe('plain Advance / Approve / Awarded need no note', () => {
  for (const [gateKey, keys] of Object.entries(PLAIN)) {
    for (const key of keys) {
      it(`${gateKey}/${key}`, () => {
        expect(outcome(gateKey, key).requiresNote).toBe(false);
      });
    }
  }
});
