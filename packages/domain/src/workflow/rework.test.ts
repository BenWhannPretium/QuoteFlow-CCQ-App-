import { describe, expect, it } from 'vitest';

import { evaluateTransition } from './evaluate';
import { INTAKE_STAGE_KEY, asksScopeChange, planResubmitRoute, planReworkReturn } from './rework';
import { NOW, makeActor, makeQuote, validCase } from '../test-utils';
import { buildHybridConfig, hybridConfig } from './seeds/hybrid';
import type { Role } from '../types/roles';

/**
 * FB-01 F-029 (Pricing can send the quote back to the KAM) and F-030 (the KAM's fix goes straight back
 * to Pricing unless the scope changed): the routing table.
 */
const DECIDER: Record<string, Role> = { G2: 'EngLead', G3: 'PricingLead', G4: 'Approver' };
const decide = (gateKey: string, outcomeKey: string) => {
  const gate = hybridConfig.gates.find((g) => g.key === gateKey)!;
  const c = validCase(hybridConfig, gateKey, outcomeKey);
  const actor = makeActor(DECIDER[gateKey] ?? 'SalesLeader');
  return evaluateTransition(
    hybridConfig,
    makeQuote(gate.stageKey, { fields: c.fields }),
    actor,
    c.request,
    NOW,
  );
};

describe('G3 "Rework (back to KAM)" (F-029)', () => {
  const outcome = hybridConfig.outcomes.find((o) => o.gateKey === 'G3' && o.key === 'rework_kam')!;
  const transition = hybridConfig.transitions.find(
    (t) => t.gateKey === 'G3' && t.outcomeKey === 'rework_kam',
  )!;

  it('is offered at G3 next to "Rework (back to Engineering)"', () => {
    expect(outcome).toMatchObject({
      label: 'Rework (back to KAM)',
      requiresNote: true,
      requiresReasonCode: true,
      reasonContext: 'rework',
      resumeAt: 'origin',
      provisional: true,
    });
    expect(outcome.helpText).toMatch(/straight back to Quoting/);
    expect(hybridConfig.outcomes.find((o) => o.gateKey === 'G3' && o.key === 'rework')?.label).toBe(
      'Rework (back to Engineering)',
    );
    expect(transition).toMatchObject({
      targetStageKeys: ['INTAKE'],
      nextStatus: 'active',
      versionBump: true,
    });
  });

  it('needs a reason from the rework context and a note', () => {
    const r = evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING'),
      makeActor('PricingLead'),
      { gateKey: 'G3', outcomeKey: 'rework_kam' },
      NOW,
    );
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED', 'REASON_REQUIRED']);
    const wrongContext = evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING'),
      makeActor('PricingLead'),
      { gateKey: 'G3', outcomeKey: 'rework_kam', reasonCode: 'not_strategic', note: 'x' },
      NOW,
    );
    expect(!wrongContext.ok && wrongContext.errors.map((e) => e.code)).toEqual(['INVALID_REASON']);
  });

  it('is decided by the pricing lead only (gate.G3.submit): a pricer cannot', () => {
    const c = validCase(hybridConfig, 'G3', 'rework_kam');
    for (const role of ['Pricing', 'KAM', 'EngLead', 'Approver', 'SalesLeader'] as const) {
      const r = evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING'),
        makeActor(role),
        c.request,
        NOW,
      );
      expect(!r.ok && r.errors.map((e) => e.code), role).toContain('NOT_PERMITTED');
    }
  });

  it('sends the quote to the KAM with a version bump, the KAM told, and records where it came from', () => {
    const r = decide('G3', 'rework_kam');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effects).toMatchObject({
      nextStageKey: INTAKE_STAGE_KEY,
      nextVersion: 2,
      versionBump: true,
      reworkReturn: { originStageKey: 'QUOTING', resumeAt: 'origin' },
    });
    expect(r.effects.notifications).toEqual([
      { type: 'quote.reworked', recipient: { kind: 'user', userId: 'user-kam' } },
    ]);
  });
});

describe('every other rework resumes at intake (unchanged)', () => {
  it.each([
    ['G1', 'rework', 'INTAKE'],
    ['G2', 'rework', 'ENG_REVIEW'],
  ])('%s %s', (gateKey, outcomeKey, origin) => {
    const r = decide(gateKey, outcomeKey);
    expect(r.ok && r.effects.reworkReturn).toEqual({ originStageKey: origin, resumeAt: 'intake' });
  });

  it('only G3 "Rework (back to KAM)" resumes at its origin in the seed', () => {
    expect(
      hybridConfig.outcomes
        .filter((o) => o.resumeAt === 'origin')
        .map((o) => `${o.gateKey}/${o.key}`),
    ).toEqual(['G3/rework_kam']);
  });

  it('decisions that do not return to the KAM record nothing', () => {
    for (const [g, o] of [
      ['G2', 'proceed'],
      ['G3', 'rework'],
      ['G3', 'recost'],
      ['G3', 'hold'],
      ['G4', 'return'],
    ] as const) {
      const r = decide(g, o);
      expect(r.ok && r.effects.reworkReturn, `${g}/${o}`).toBeNull();
    }
  });
});

describe('planReworkReturn / asksScopeChange', () => {
  it('records the origin only when the quote enters Intake', () => {
    expect(planReworkReturn({ resumeAt: 'origin' }, 'QUOTING', 'ENG_REVIEW')).toBeNull();
    expect(planReworkReturn({ resumeAt: 'origin' }, 'QUOTING', 'INTAKE')).toEqual({
      originStageKey: 'QUOTING',
      resumeAt: 'origin',
    });
    // From Intake itself there is nothing else to resume at.
    expect(planReworkReturn({ resumeAt: 'origin' }, 'INTAKE', 'INTAKE')).toEqual({
      originStageKey: 'INTAKE',
      resumeAt: 'intake',
    });
  });

  it('asks the KAM only for an origin rework from another stage', () => {
    expect(asksScopeChange({ originStageKey: 'QUOTING', resumeAt: 'origin' })).toBe(true);
    expect(asksScopeChange({ originStageKey: 'QUOTING', resumeAt: 'intake' })).toBe(false);
    expect(asksScopeChange({ originStageKey: 'INTAKE', resumeAt: 'origin' })).toBe(false);
    expect(asksScopeChange(null)).toBe(false);
    expect(asksScopeChange({})).toBe(false);
  });
});

describe('planResubmitRoute: the routing table (F-030)', () => {
  const fromPricing = { originStageKey: 'QUOTING', resumeAt: 'origin' } as const;
  const fromEngineering = { originStageKey: 'ENG_REVIEW', resumeAt: 'intake' } as const;

  it('no scope change: straight back to Quoting', () => {
    expect(planResubmitRoute(hybridConfig, fromPricing, false)).toEqual({
      ok: true,
      route: 'origin',
      stageKey: 'QUOTING',
    });
  });

  it('scope changed: a new submission (G1 if enabled, then Engineering)', () => {
    expect(planResubmitRoute(hybridConfig, fromPricing, true)).toEqual({
      ok: true,
      route: 'intake',
    });
    // The same with G1 switched off: the service then uses the KAM's own submit gate.
    expect(planResubmitRoute(buildHybridConfig({ g1Enabled: false }), fromPricing, true)).toEqual({
      ok: true,
      route: 'intake',
    });
  });

  it('the answer is required when the rework resumes at its origin', () => {
    for (const answer of [undefined, null]) {
      const r = planResubmitRoute(hybridConfig, fromPricing, answer);
      expect(!r.ok && r.errors.map((e) => [e.code, e.field])).toEqual([
        ['SCOPE_CHANGE_REQUIRED', 'scopeChanged'],
      ]);
    }
  });

  it('G1 / G2 reworks and new quotes route as today, whatever the answer', () => {
    for (const answer of [undefined, true, false]) {
      expect(planResubmitRoute(hybridConfig, fromEngineering, answer)).toEqual({
        ok: true,
        route: 'intake',
      });
      expect(planResubmitRoute(hybridConfig, null, answer)).toEqual({ ok: true, route: 'intake' });
    }
  });

  it('an origin no longer in the config, or terminal, falls back to a new submission', () => {
    expect(
      planResubmitRoute(hybridConfig, { originStageKey: 'GONE', resumeAt: 'origin' }, false),
    ).toEqual({ ok: true, route: 'intake' });
    expect(
      planResubmitRoute(hybridConfig, { originStageKey: 'DECLINED', resumeAt: 'origin' }, false),
    ).toEqual({ ok: true, route: 'intake' });
  });
});
