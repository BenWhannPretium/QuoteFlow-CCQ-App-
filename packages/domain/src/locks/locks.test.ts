import { describe, expect, it } from 'vitest';

import {
  LOCK_SECTIONS,
  SECTION_LOCK_GATE,
  sectionLock,
  sectionLockedError,
  sectionLocks,
  type LockSection,
} from './index';
import { canEditEngReview } from '../engineering/review';
import { canEditQuoting } from '../pricing/record';
import { NOW, makeActor, makeQuote, validCase } from '../test-utils';
import { asUserId } from '../types/ids';
import type { GateDecisionRef } from '../types/quote';
import { evaluateTransition } from '../workflow/evaluate';
import { hybridConfig } from '../workflow/seeds/hybrid';

/**
 * FB-01 (F-001): a section is read-only for every role once its gate is decided with an advancing
 * outcome, until a send-back reopens it. Each section × each outcome of its gate, plus every send-back.
 */
let clock = NOW.getTime();
const at = () => new Date((clock += 60_000));

/** The decision `evaluateTransition` would record (so the target is the config's, not a guess). */
function decided(gateKey: string, outcomeKey: string, targetStageKey?: string): GateDecisionRef {
  const c = validCase(hybridConfig, gateKey, outcomeKey);
  const gate = hybridConfig.gates.find((g) => g.key === gateKey)!;
  // One actor who may decide every gate (not the KAM, not the price approver: no segregation).
  const actor = makeActor(['SalesLeader', 'EngLead', 'PricingLead', 'Approver'], {
    userId: asUserId('user-decider'),
  });
  const result = evaluateTransition(
    hybridConfig,
    makeQuote(gate.stageKey, { fields: c.fields }),
    actor,
    { ...c.request, ...(targetStageKey ? { targetStageKey } : {}) },
    NOW,
  );
  if (!result.ok) throw new Error(`${gateKey}/${outcomeKey}: ${result.errors[0]?.message}`);
  return {
    gateKey,
    outcomeKey,
    decidedBy: 'user-decider',
    decidedAt: at(),
    targetStageKey: result.effects.gateDecisionRecord.targetStageKey,
  };
}

const lock = (section: LockSection, decisions: GateDecisionRef[]) =>
  sectionLock(section, hybridConfig, { decisions });

const outcomesOf = (gateKey: string) =>
  hybridConfig.outcomes.filter((o) => o.gateKey === gateKey).map((o) => o.key);

/** The outcomes that move the quote on to a later stage: these lock the section. */
const ADVANCING: Record<string, string[]> = {
  G2: ['proceed', 'proceed_with_risk', 'capital_required'],
  G3: ['submit'],
  G4: ['approve'],
};

/** A history that brings the quote to the stage of `gateKey` (each earlier gate advanced). */
function upTo(gateKey: string): GateDecisionRef[] {
  const path: [string, string][] = [
    ['G1', 'advance'],
    ['G2', 'proceed'],
    ['G3', 'submit'],
    ['G4', 'approve'],
  ];
  const i = path.findIndex(([g]) => g === gateKey);
  return path.slice(0, i).map(([g, o]) => decided(g, o));
}

describe('section × gate outcome (F-001)', () => {
  for (const section of LOCK_SECTIONS) {
    const gateKey = SECTION_LOCK_GATE[section];
    for (const outcomeKey of outcomesOf(gateKey)) {
      const advancing = ADVANCING[gateKey]!.includes(outcomeKey);
      it(`${section}: ${gateKey} ${outcomeKey} ${advancing ? 'locks' : 'does not lock'}`, () => {
        const before = upTo(gateKey);
        expect(lock(section, before).locked).toBe(false);
        const transition = hybridConfig.transitions.find(
          (t) => t.gateKey === gateKey && t.outcomeKey === outcomeKey,
        )!;
        const d = decided(gateKey, outcomeKey, transition.targetStageKeys[0]);
        const result = lock(section, [...before, d]);
        expect(result.locked).toBe(advancing);
        if (advancing) {
          expect(result).toMatchObject({
            gate: gateKey,
            outcomeKey,
            decidedBy: 'user-decider',
            decidedAt: d.decidedAt,
          });
        } else {
          expect(result).toMatchObject({ gate: null, decidedBy: null, decidedAt: null });
        }
      });
    }
  }

  it('the gate of each section', () => {
    expect(SECTION_LOCK_GATE).toEqual({
      engineering: 'G2',
      pricing: 'G3',
      commercialTerms: 'G4',
      capitalFlag: 'G4',
    });
  });

  it('nothing is locked on a new quote, or before any gate is decided', () => {
    for (const s of LOCK_SECTIONS) {
      expect(lock(s, []).locked).toBe(false);
      expect(sectionLock(s, hybridConfig, {}).locked).toBe(false);
    }
  });

  it('a gate that is not in the config locks nothing', () => {
    const config = { ...hybridConfig, gates: hybridConfig.gates.filter((g) => g.key !== 'G2') };
    expect(sectionLock('engineering', config, { decisions: upTo('G3') }).locked).toBe(false);
  });

  it('two decisions at the same instant are ordered by when they were recorded', () => {
    const same = new Date('2026-11-05T15:00:00Z');
    const g1 = { ...decided('G1', 'advance'), decidedAt: same, recordedAt: new Date(1) };
    const g2 = { ...decided('G2', 'proceed'), decidedAt: same, recordedAt: new Date(2) };
    // Newest first, as the database lists them: G2 (locks) was recorded after G1 (enters Engineering).
    expect(lock('engineering', [g2, g1]).locked).toBe(true);
    expect(lock('engineering', [g1, g2]).locked).toBe(true);
  });

  it('the order the decisions are listed in does not matter (newest first from the DB)', () => {
    const history = [...upTo('G4'), decided('G4', 'approve')];
    expect(sectionLocks(hybridConfig, { decisions: [...history].reverse() })).toEqual(
      sectionLocks(hybridConfig, { decisions: history }),
    );
  });
});

describe('send-backs reopen the target stage and every later one (F-001)', () => {
  const afterG4 = () => [...upTo('G4'), decided('G4', 'approve')];
  const states = (decisions: GateDecisionRef[]) =>
    Object.fromEntries(LOCK_SECTIONS.map((s) => [s, lock(s, decisions).locked]));

  it('after G4 Advance every section is locked', () => {
    expect(states(afterG4())).toEqual({
      engineering: true,
      pricing: true,
      commercialTerms: true,
      capitalFlag: true,
    });
  });

  it('G3 Rework → Engineering reopens engineering (and pricing stays open)', () => {
    const h = [...upTo('G3'), decided('G3', 'rework')];
    expect(states(h)).toEqual({
      engineering: false,
      pricing: false,
      commercialTerms: false,
      capitalFlag: false,
    });
    // Engineering advances again: locked again.
    expect(lock('engineering', [...h, decided('G2', 'proceed')]).locked).toBe(true);
  });

  it('G3 Rework (back to KAM) reopens engineering and pricing', () => {
    const h = [...upTo('G3'), decided('G3', 'rework_kam')];
    expect(states(h)).toMatchObject({ engineering: false, pricing: false });
  });

  it('G4 Return to Quoting reopens pricing but not engineering', () => {
    const h = [...upTo('G4'), decided('G4', 'return', 'QUOTING')];
    expect(states(h)).toEqual({
      engineering: true,
      pricing: false,
      commercialTerms: false,
      capitalFlag: false,
    });
  });

  it('G4 Return to Engineering reopens engineering and pricing', () => {
    const h = [...upTo('G4'), decided('G4', 'return', 'ENG_REVIEW')];
    expect(states(h)).toMatchObject({ engineering: false, pricing: false });
  });

  it('G5 Re-quote to Quoting reopens pricing, terms and the capital flag; engineering stays locked', () => {
    const h = [...afterG4(), decided('G5', 'requote', 'QUOTING')];
    expect(states(h)).toEqual({
      engineering: true,
      pricing: false,
      commercialTerms: false,
      capitalFlag: false,
    });
  });

  it('G6 Re-quote to Engineering reopens everything', () => {
    const h = [...afterG4(), decided('G5', 'awarded'), decided('G6', 'requote', 'ENG_REVIEW')];
    expect(Object.values(states(h))).toEqual([false, false, false, false]);
  });

  it('holds, re-costs and redirects keep the stage: they neither lock nor reopen', () => {
    const h = [...afterG4(), decided('G5', 'on_hold'), decided('G5', 'negotiating')];
    expect(Object.values(states(h))).toEqual([true, true, true, true]);
  });

  it('a decision closing the quote (terminal stage) does not reopen anything', () => {
    const h = [...afterG4(), decided('G5', 'lost')];
    expect(Object.values(states(h))).toEqual([true, true, true, true]);
  });
});

describe('the canEdit checks go through the locks', () => {
  const engLead = makeActor('EngLead');
  const pricing = makeActor('Pricing');

  it('engineering: editable in Engineering Review until G2 advances, again after a send-back', () => {
    const inEng = makeQuote('ENG_REVIEW', { decisions: upTo('G2') });
    expect(canEditEngReview(engLead, inEng, hybridConfig)).toBe(true);
    // A history that says G2 advanced, with nothing reopening it, locks even in the stage.
    const stale = makeQuote('ENG_REVIEW', { decisions: upTo('G3') });
    expect(canEditEngReview(engLead, stale, hybridConfig)).toBe(false);
    const reopened = makeQuote('ENG_REVIEW', {
      decisions: [...upTo('G3'), decided('G3', 'rework')],
    });
    expect(canEditEngReview(engLead, reopened, hybridConfig)).toBe(true);
  });

  it('pricing: locked once G3 advances, reopened by a G4 Return', () => {
    const locked = makeQuote('QUOTING', { decisions: upTo('G4') });
    expect(canEditQuoting(pricing, locked, hybridConfig)).toBe(false);
    const returned = makeQuote('QUOTING', {
      decisions: [...upTo('G4'), decided('G4', 'return', 'QUOTING')],
    });
    expect(canEditQuoting(pricing, returned, hybridConfig)).toBe(true);
  });
});

describe('sectionLockedError', () => {
  it('names the section, the gate, the decider and the date', () => {
    const l = lock('commercialTerms', [...upTo('G4'), decided('G4', 'approve')]);
    const e = sectionLockedError('commercialTerms', l, 'Avery Approver');
    expect(e.code).toBe('SECTION_LOCKED');
    expect(e.message).toMatch(
      /^The commercial terms are locked after G4 \(decided by Avery Approver on \d{4}-\d{2}-\d{2}\)\. It reopens only if the quote is sent back\.$/,
    );
  });
});
