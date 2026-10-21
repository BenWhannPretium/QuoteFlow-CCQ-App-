import { describe, expect, it } from 'vitest';

import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { finalReviewAvailability } from './availability';
import {
  FINAL_REVIEW_FLAGGED_G2,
  filterFinalReviewQueue,
  sortFinalReviewQueue,
  type FinalReviewEntry,
} from './queue';
import {
  VALIDITY_DAYS_SEED,
  addCalendarDays,
  parseValidityDays,
  planProposalRelease,
  proposalCalendarDate,
  releasesProposal,
  validityUntil,
} from './release';
import {
  approverRequirement,
  approverTierErrors,
  parseApproverTierRules,
  requiredApproverTier,
  type ApproverTierRules,
} from './tiers';
import { reviewWarnings } from './warnings';
import { asUserId } from '../types/ids';
import { availableActions } from '../workflow/available-actions';
import { evaluateTransition, type TransitionRequest } from '../workflow/evaluate';
import { buildHybridConfig, hybridConfig } from '../workflow/seeds';

const PRICE_APPROVER = asUserId('user-pricing');

type Extra = { [K in keyof TransitionRequest]?: TransitionRequest[K] | undefined };

/** `extra` overlays the base request; an explicit `undefined` removes the key (a missing note, reason…). */
function overlay(base: TransitionRequest, extra: Extra): TransitionRequest {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as unknown as TransitionRequest;
}

/** A quote waiting at Final Review whose rules are all satisfied. */
function g4(outcomeKey: string, extra: Extra = {}, quote = {}) {
  const c = validCase(hybridConfig, 'G4', outcomeKey);
  return {
    c,
    quote: makeQuote('FINAL_REVIEW', { fields: c.fields, ...quote }),
    request: overlay(c.request, extra),
  };
}
const decide = (
  outcomeKey: string,
  roles: Parameters<typeof makeActor>[0] = 'Approver',
  extra: Extra = {},
  quote = {},
  options: Parameters<typeof evaluateTransition>[5] = {},
  actorOverrides = {},
) => {
  const { quote: q, request } = g4(outcomeKey, extra, quote);
  return evaluateTransition(
    hybridConfig,
    q,
    makeActor(roles, actorOverrides),
    request,
    NOW,
    options,
  );
};
const codes = (r: ReturnType<typeof decide>) => (r.ok ? [] : r.errors.map((e) => e.code));

describe('G4 is an internal decision (X-88): it never awards or loses a quote', () => {
  const g4Transitions = hybridConfig.transitions.filter((t) => t.gateKey === 'G4');

  it('no G4 transition targets Awarded / Closed Lost or closes as awarded / lost', () => {
    expect(g4Transitions.map((t) => t.outcomeKey).sort()).toEqual([
      'approve',
      'decline',
      'hold',
      'return',
    ]);
    for (const t of g4Transitions) {
      expect(t.targetStageKeys).not.toContain('AWARDED');
      expect(t.targetStageKeys).not.toContain('CLOSED_LOST');
      expect(['awarded', 'lost']).not.toContain(t.closeAs);
    }
  });

  it('Approve moves to Customer Decision and the quote stays open', () => {
    const r = decide('approve');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effects.fromStageKey).toBe('FINAL_REVIEW');
    expect(r.effects.nextStageKey).toBe('CUSTOMER_DECISION');
    expect(r.effects.nextStatus).toBe('active');
    expect(r.effects.closeAs).toBeUndefined();
    expect(r.effects.versionBump).toBe(false);
  });

  it('Decline closes as DECLINED (an internal no-go), not as a customer loss', () => {
    const r = decide('decline');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effects.nextStageKey).toBe('DECLINED');
    expect(r.effects.nextStatus).toBe('closed');
    expect(r.effects.closeAs).toBe('declined');
    expect(r.effects.gateDecisionRecord.decidedBy).toBe(OTHER_ID);
  });

  it('only the customer outcome can lose (G5), and only G6 closes Won after an award (B-26)', () => {
    const gatesClosingAs = (closeAs: string) =>
      new Set(hybridConfig.transitions.filter((t) => t.closeAs === closeAs).map((t) => t.gateKey));
    expect(gatesClosingAs('lost')).toEqual(new Set(['G5']));
    expect(gatesClosingAs('awarded')).toEqual(new Set(['G6']));
  });

  it('G4 stays on the Approver permission, nothing else', () => {
    expect(hybridConfig.gates.find((g) => g.key === 'G4')?.deciderPermission).toBe(
      'gate.G4.decide',
    );
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'Leadership',
      'Admin',
    ] as const) {
      expect(codes(decide('approve', role)), role).toContain('NOT_PERMITTED');
    }
  });
});

describe('G4 outcome rules', () => {
  it('Approve takes an optional note and nothing else', () => {
    expect(decide('approve').ok).toBe(true);
    expect(decide('approve', 'Approver', { note: 'Within the approved range' }).ok).toBe(true);
  });

  it('Decline needs a note AND a decline reason code (the 10/14 demo rule)', () => {
    expect(
      codes(decide('decline', 'Approver', { note: undefined, reasonCode: undefined })),
    ).toEqual(expect.arrayContaining(['NOTE_REQUIRED', 'REASON_REQUIRED']));
    expect(codes(decide('decline', 'Approver', { note: undefined }))).toEqual(['NOTE_REQUIRED']);
    expect(codes(decide('decline', 'Approver', { reasonCode: undefined }))).toEqual([
      'REASON_REQUIRED',
    ]);
    expect(codes(decide('decline', 'Approver', { note: '   ' }))).toEqual(['NOTE_REQUIRED']);
  });

  it('Decline accepts only reason codes from the decline context', () => {
    // `price` is a Lost reason, `scope_unclear` a Rework reason: neither is a decline reason.
    expect(codes(decide('decline', 'Approver', { reasonCode: 'price' }))).toEqual([
      'INVALID_REASON',
    ]);
    expect(codes(decide('decline', 'Approver', { reasonCode: 'scope_unclear' }))).toEqual([
      'INVALID_REASON',
    ]);
    expect(decide('decline', 'Approver', { reasonCode: 'margin_below_floor' }).ok).toBe(true);
  });

  it('Return needs a note and a target stage (Quoting or Engineering Review)', () => {
    expect(codes(decide('return', 'Approver', { note: undefined }))).toEqual(['NOTE_REQUIRED']);
    expect(codes(decide('return', 'Approver', { targetStageKey: undefined }))).toEqual([
      'TARGET_REQUIRED',
    ]);
    expect(codes(decide('return', 'Approver', { targetStageKey: 'INTAKE' }))).toEqual([
      'INVALID_TARGET',
    ]);
    expect(codes(decide('return', 'Approver', { targetStageKey: 'CUSTOMER_DECISION' }))).toEqual([
      'INVALID_TARGET',
    ]);
  });

  it.each(['QUOTING', 'ENG_REVIEW'])('Return to %s bumps the version and stays open', (target) => {
    const r = decide('return', 'Approver', { targetStageKey: target }, { version: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effects.nextStageKey).toBe(target);
    expect(r.effects.nextStatus).toBe('active');
    expect(r.effects.versionBump).toBe(true);
    expect(r.effects.nextVersion).toBe(3);
    // The decision is recorded against the version it was taken on: prior approvals are never edited (CR-38).
    expect(r.effects.gateDecisionRecord.quoteVersion).toBe(2);
    expect(r.effects.activityEvents.map((e) => e.type)).toContain('version_bumped');
  });

  it('notifies the KAM on Approve, the KAM and Pricing on Decline', () => {
    const approve = decide('approve');
    expect(approve.ok && approve.effects.notifications).toEqual([
      { type: 'quote.approved_for_customer', recipient: { kind: 'user', userId: KAM_ID } },
    ]);
    const decline = decide('decline');
    expect(decline.ok && decline.effects.notifications).toEqual([
      { type: 'quote.declined', recipient: { kind: 'user', userId: KAM_ID } },
      { type: 'quote.declined', recipient: { kind: 'role', role: 'Pricing' } },
    ]);
  });

  it('the G4 gate can be switched off in config like any other', () => {
    const config = structuredClone(hybridConfig);
    config.gates.find((g) => g.key === 'G4')!.enabled = false;
    const { quote, request } = g4('approve');
    const r = evaluateTransition(config, quote, makeActor('Approver'), request, NOW);
    expect(!r.ok && r.errors.map((e) => e.code)).toContain('GATE_DISABLED');
  });
});

describe('segregation (domain rules, B-12)', () => {
  const asApprover = (userId: ReturnType<typeof asUserId>) => makeActor('Approver', { userId });

  it("the approver cannot be the quote's KAM, on any G4 outcome", () => {
    for (const outcome of ['approve', 'decline', 'return']) {
      expect(codes(decide(outcome, 'Approver', {}, {}, {}, { userId: KAM_ID })), outcome).toEqual([
        'SEGREGATION',
      ]);
    }
  });

  it('the approver cannot be the Pricing approver on this quote (price approver or G3 submitter)', () => {
    for (const outcome of ['approve', 'decline', 'return']) {
      const r = decide(
        outcome,
        'Approver',
        {},
        { priceApproverIds: [PRICE_APPROVER] },
        {},
        {
          userId: PRICE_APPROVER,
        },
      );
      expect(codes(r), outcome).toEqual(['SEGREGATION']);
    }
  });

  it('says why', () => {
    const r = decide(
      'approve',
      'Approver',
      {},
      { priceApproverIds: [PRICE_APPROVER] },
      {},
      {
        userId: PRICE_APPROVER,
      },
    );
    expect(!r.ok && r.errors[0]?.message).toMatch(/price you approved or submitted/);
    const k = decide('approve', 'Approver', {}, {}, {}, { userId: KAM_ID });
    expect(!k.ok && k.errors[0]?.message).toMatch(/you are the KAM/);
  });

  it('holding several roles does not lift it (a SalesLeader + Approver who is the KAM)', () => {
    const r = decide('approve', ['SalesLeader', 'Approver'], {}, {}, {}, { userId: KAM_ID });
    expect(codes(r)).toEqual(['SEGREGATION']);
  });

  it('a different Approver, and a Pricing approver of another quote, are not blocked', () => {
    expect(decide('approve', 'Approver', {}, { priceApproverIds: [PRICE_APPROVER] }).ok).toBe(true);
    expect(
      evaluateTransition(
        hybridConfig,
        g4('approve', {}, { priceApproverIds: [] }).quote,
        asApprover(PRICE_APPROVER),
        g4('approve').request,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('the rules are config: removing them lifts the block', () => {
    const config = structuredClone(hybridConfig);
    config.segregation = [];
    const { quote, request } = g4('approve');
    expect(
      evaluateTransition(config, quote, makeActor('Approver', { userId: KAM_ID }), request, NOW).ok,
    ).toBe(true);
  });
});

describe('proposal dates (CR-29, D-12)', () => {
  it('Approve releases the proposition; no other outcome or gate does', () => {
    expect(releasesProposal(hybridConfig, 'G4', 'approve')).toBe(true);
    for (const [gate, outcome] of [
      ['G4', 'decline'],
      ['G4', 'return'],
      ['G3', 'submit'],
      ['G5', 'awarded'],
      ['G5', 'requote'],
      ['G4', 'nope'],
      ['G9', 'approve'],
    ] as const) {
      expect(releasesProposal(hybridConfig, gate, outcome), `${gate}/${outcome}`).toBe(false);
    }
  });

  it('is decided by the transition (into Customer Decision), not by the outcome name', () => {
    const config = structuredClone(hybridConfig);
    const approve = config.outcomes.find((o) => o.gateKey === 'G4' && o.key === 'approve')!;
    approve.key = 'release';
    config.transitions.find((t) => t.gateKey === 'G4' && t.outcomeKey === 'approve')!.outcomeKey =
      'release';
    expect(releasesProposal(config, 'G4', 'release')).toBe(true);
    expect(releasesProposal(config, 'G4', 'approve')).toBe(false);
  });

  it('issued defaults to now and validity is issued + the configured days', () => {
    const plan = planProposalRelease({ now: NOW, validityDays: 30 });
    expect(plan).toEqual({
      ok: true,
      proposalIssuedAt: NOW,
      validityUntil: '2026-11-19',
      validityDays: 30,
    });
  });

  it('takes the days from config, never a literal', () => {
    const at = (days: number) => {
      const p = planProposalRelease({ now: NOW, validityDays: days });
      return p.ok ? p.validityUntil : null;
    };
    expect(at(30)).toBe('2026-11-19');
    expect(at(60)).toBe('2026-12-19');
    expect(at(1)).toBe('2026-10-21');
  });

  it('the send date is editable to the actual (earlier) date, and validity follows it', () => {
    const sent = new Date('2026-10-15T14:00:00Z');
    const plan = planProposalRelease({ now: NOW, issuedAt: sent, validityDays: 30 });
    expect(plan).toMatchObject({ ok: true, proposalIssuedAt: sent, validityUntil: '2026-11-14' });
  });

  it('refuses a send date in the future (a few minutes of clock skew are fine)', () => {
    const future = planProposalRelease({
      now: NOW,
      issuedAt: new Date(NOW.getTime() + 3_600_000),
      validityDays: 30,
    });
    expect(future.ok).toBe(false);
    expect(!future.ok && future.errors.map((e) => [e.code, e.field])).toEqual([
      ['INVALID_PROPOSAL_DATE', 'proposalIssuedAt'],
    ]);
    expect(
      planProposalRelease({
        now: NOW,
        issuedAt: new Date(NOW.getTime() + 2 * 60_000),
        validityDays: 30,
      }).ok,
    ).toBe(true);
    expect(planProposalRelease({ now: NOW, issuedAt: new Date('nope'), validityDays: 30 }).ok).toBe(
      false,
    );
  });

  it('counts the calendar date at Pretium HQ (US Central), not UTC', () => {
    // 02:00 UTC on Oct 21 is still the evening of Oct 20 in Chicago.
    const late = new Date('2026-10-21T02:00:00Z');
    expect(proposalCalendarDate(late)).toBe('2026-10-20');
    expect(validityUntil(late, 30)).toBe('2026-11-19');
    // And across the DST change (Nov 1, 2026) a day is still a calendar day.
    expect(validityUntil(new Date('2026-10-20T15:00:00Z'), 14)).toBe('2026-11-03');
  });

  it('adds calendar days across months and years', () => {
    expect(addCalendarDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('validity_days_default: seed when absent, whole days from 1 to 730 otherwise', () => {
    expect(parseValidityDays(undefined)).toBe(VALIDITY_DAYS_SEED);
    expect(parseValidityDays(null)).toBe(VALIDITY_DAYS_SEED);
    expect(parseValidityDays(60)).toBe(60);
    for (const bad of [0, -5, 1.5, 731, '30', NaN, {}]) {
      expect(() => parseValidityDays(bad), JSON.stringify(bad)).toThrow(/validity_days_default/);
    }
  });
});

describe('approver tiers (D-10): a hook, disabled by default', () => {
  // A SAMPLE rule, enabled in these tests only: the seed setting is null.
  const SAMPLE: ApproverTierRules = parseApproverTierRules({
    tiers: [
      {
        key: 'standard',
        label: 'Capital over $250k',
        minCapitalUsd: 250_000,
        approverRoles: ['Approver'],
      },
      {
        key: 'executive',
        label: 'Capital over $1M or revenue over $5M',
        minCapitalUsd: 1_000_000,
        minAnnualRevenueUsd: 5_000_000,
        approverRoles: ['Leadership'],
        approverUserIds: ['user-delegate'],
      },
    ],
  })!;
  const withFields = (fields: Record<string, unknown>) => ({
    fields: { ...validCase(hybridConfig, 'G4', 'approve').fields, ...fields },
  });
  const run = (
    outcome: string,
    roles: Parameters<typeof makeActor>[0],
    fields: Record<string, unknown>,
    rules: ApproverTierRules | null = SAMPLE,
    userId = OTHER_ID,
  ) => {
    const c = validCase(hybridConfig, 'G4', outcome);
    return evaluateTransition(
      hybridConfig,
      makeQuote('FINAL_REVIEW', { fields: { ...c.fields, ...fields } }),
      makeActor(roles, { userId }),
      c.request,
      NOW,
      { approverTiers: rules },
    );
  };

  it('is off in the seed: no tier is ever required', () => {
    expect(parseApproverTierRules(null)).toBeNull();
    expect(parseApproverTierRules(undefined)).toBeNull();
    expect(run('approve', 'Approver', { prelim_capital_usd: 50_000_000 }, null).ok).toBe(true);
    expect(
      approverTierErrors(null, { prelim_capital_usd: 9e9 }, makeActor('Approver'), 'G4', 'approve'),
    ).toEqual([]);
  });

  it('a quote under every threshold needs nothing extra', () => {
    expect(
      run('approve', 'Approver', { prelim_capital_usd: 100_000, est_annual_revenue: 1e6 }).ok,
    ).toBe(true);
    expect(requiredApproverTier(SAMPLE, { capitalUsd: null, annualRevenueUsd: null })).toBeNull();
  });

  it('the highest tier a quote falls in decides who may approve it', () => {
    expect(requiredApproverTier(SAMPLE, { capitalUsd: 300_000, annualRevenueUsd: null })?.key).toBe(
      'standard',
    );
    expect(requiredApproverTier(SAMPLE, { capitalUsd: 300_000, annualRevenueUsd: 6e6 })?.key).toBe(
      'executive',
    );
    expect(requiredApproverTier(SAMPLE, { capitalUsd: null, annualRevenueUsd: 6e6 })?.key).toBe(
      'executive',
    );
    expect(
      requiredApproverTier(SAMPLE, { capitalUsd: 1_000_000, annualRevenueUsd: null })?.key,
    ).toBe('executive');
  });

  it('an Approver is enough for the standard tier, not for the executive tier', () => {
    expect(run('approve', 'Approver', { prelim_capital_usd: 300_000 }).ok).toBe(true);
    const r = run('approve', 'Approver', { prelim_capital_usd: 2_000_000 });
    expect(codes(r)).toEqual(['TIER_APPROVER_REQUIRED']);
    expect(!r.ok && r.errors[0]?.message).toMatch(/Capital over \$1M or revenue over \$5M/);
  });

  it('the required group can satisfy it through a second role or a named delegate', () => {
    expect(run('approve', ['Approver', 'Leadership'], { prelim_capital_usd: 2_000_000 }).ok).toBe(
      true,
    );
    expect(
      run(
        'approve',
        'Approver',
        { prelim_capital_usd: 2_000_000 },
        SAMPLE,
        asUserId('user-delegate'),
      ).ok,
    ).toBe(true);
    // Holding only the tier's role is not enough: the actor must still hold gate.G4.decide.
    expect(codes(run('approve', 'Leadership', { prelim_capital_usd: 2_000_000 }))).toEqual([
      'NOT_PERMITTED',
    ]);
  });

  it('revenue can trigger a tier on its own, and numeric strings from the database count', () => {
    expect(codes(run('approve', 'Approver', { est_annual_revenue: 6_000_000 }))).toEqual([
      'TIER_APPROVER_REQUIRED',
    ]);
    expect(codes(run('approve', 'Approver', { prelim_capital_usd: '2000000.00' }))).toEqual([
      'TIER_APPROVER_REQUIRED',
    ]);
  });

  it('gates Approve only by default: Decline and Return stay open to any Approver', () => {
    expect(run('decline', 'Approver', { prelim_capital_usd: 2_000_000 }).ok).toBe(true);
    expect(run('return', 'Approver', { prelim_capital_usd: 2_000_000 }).ok).toBe(true);
    const all = parseApproverTierRules({
      outcomeKeys: ['approve', 'decline', 'return'],
      tiers: [{ key: 't', label: 'T', minCapitalUsd: 1, approverRoles: ['Leadership'] }],
    });
    expect(codes(run('decline', 'Approver', { prelim_capital_usd: 5 }, all))).toEqual([
      'TIER_APPROVER_REQUIRED',
    ]);
  });

  it('only ever applies to G4', () => {
    expect(
      approverTierErrors(
        SAMPLE,
        { prelim_capital_usd: 9e9 },
        makeActor('Approver'),
        'G3',
        'approve',
      ),
    ).toEqual([]);
  });

  it('hides Approve from an approver who cannot take it, and explains why', () => {
    const quote = makeQuote('FINAL_REVIEW', withFields({ prelim_capital_usd: 2_000_000 }));
    const actor = makeActor('Approver');
    const keys = (rules: ApproverTierRules | null) =>
      availableActions(hybridConfig, quote, actor, { approverTiers: rules })
        .filter((a) => a.gateKey === 'G4')
        .map((a) => a.outcomeKey);
    expect(keys(null)).toEqual(['approve', 'hold', 'return', 'decline']);
    expect(keys(SAMPLE)).toEqual(['hold', 'return', 'decline']);

    const requirement = approverRequirement(SAMPLE, quote.fields, actor);
    expect(requirement).toEqual({
      tierKey: 'executive',
      tierLabel: 'Capital over $1M or revenue over $5M',
      satisfied: false,
    });
    expect(finalReviewAvailability(hybridConfig, quote, actor, { approverTiers: SAMPLE })).toEqual({
      canDecide: true, // decline and return stay available
      blockedBy: [],
    });
  });

  it('rejects malformed rules instead of silently disabling the control', () => {
    for (const bad of [
      {},
      { tiers: [] },
      { tiers: [{ key: 'a', label: 'A', approverRoles: ['Approver'] }] }, // no threshold
      { tiers: [{ key: 'a', label: 'A', minCapitalUsd: 1 }] }, // nobody can approve
      { tiers: [{ key: 'a', label: 'A', minCapitalUsd: 1, approverRoles: ['Nobody'] }] },
      {
        tiers: [
          { key: 'a', label: 'A', minCapitalUsd: 1, approverRoles: ['Approver'] },
          { key: 'a', label: 'B', minCapitalUsd: 2, approverRoles: ['Approver'] },
        ],
      },
      {
        tiers: [{ key: 'a', label: 'A', minCapitalUsd: 1, approverRoles: ['Approver'], extra: 1 }],
      },
    ]) {
      expect(() => parseApproverTierRules(bad), JSON.stringify(bad)).toThrow(/g4_tier_rules/);
    }
  });

  it('names nobody: the sample uses roles and ids only, and the seed is null', () => {
    expect(JSON.stringify(SAMPLE)).not.toMatch(/Brennan|Miller|Slomkowski/);
  });
});

describe('finalReviewAvailability', () => {
  const quote = (over = {}) =>
    makeQuote('FINAL_REVIEW', { fields: g4('approve').quote.fields, ...over });

  it('an Approver can decide; segregation explains itself when it blocks', () => {
    expect(finalReviewAvailability(hybridConfig, quote(), makeActor('Approver'))).toEqual({
      canDecide: true,
      blockedBy: [],
    });
    const asKam = finalReviewAvailability(
      hybridConfig,
      quote(),
      makeActor('Approver', { userId: KAM_ID }),
    );
    expect(asKam.canDecide).toBe(false);
    expect(asKam.blockedBy).toEqual([
      'You cannot decide Final Review on a quote where you are the KAM',
    ]);
    const asPricing = finalReviewAvailability(
      hybridConfig,
      quote({ priceApproverIds: [PRICE_APPROVER] }),
      makeActor('Approver', { userId: PRICE_APPROVER }),
    );
    expect(asPricing.blockedBy).toEqual([
      'You cannot decide Final Review on a quote whose price you approved or submitted',
    ]);
  });

  it('a read-only viewer is not "blocked": they simply are not an approver', () => {
    expect(finalReviewAvailability(hybridConfig, quote(), makeActor('Leadership'))).toEqual({
      canDecide: false,
      blockedBy: [],
    });
  });

  it('nothing to decide outside Final Review or on a closed quote', () => {
    expect(
      finalReviewAvailability(hybridConfig, makeQuote('QUOTING'), makeActor('Approver')).canDecide,
    ).toBe(false);
    expect(
      finalReviewAvailability(hybridConfig, quote({ status: 'closed' }), makeActor('Approver'))
        .canDecide,
    ).toBe(false);
    const off = buildHybridConfig();
    off.gates.find((g) => g.key === 'G4')!.enabled = false;
    expect(finalReviewAvailability(off, quote(), makeActor('Approver')).canDecide).toBe(false);
  });

  it('a tier that bars every outcome blocks the decision with the tier message', () => {
    const rules = parseApproverTierRules({
      outcomeKeys: ['approve', 'hold', 'decline', 'return'],
      tiers: [{ key: 't', label: 'Executive', minCapitalUsd: 1, approverRoles: ['Leadership'] }],
    });
    const r = finalReviewAvailability(
      hybridConfig,
      quote({ fields: { prelim_capital_usd: 10 } }),
      makeActor('Approver'),
      { approverTiers: rules },
    );
    expect(r).toEqual({
      canDecide: false,
      blockedBy: ['This quote needs approval from the "Executive" approver tier'],
    });
  });
});

describe('the Final Review queue order and filters', () => {
  const tiers = ['critical', 'high', 'standard', 'low'];
  const entry = (n: string, over: Partial<FinalReviewEntry> = {}): FinalReviewEntry => ({
    quoteNumber: n,
    tier: 'standard',
    score: 50,
    waitingMs: 0,
    g2Outcome: 'proceed',
    capitalReadiness: 'not_required',
    kamUserId: 'k1',
    searchText: n.toLowerCase(),
    ...over,
  });

  it('orders tier → score → longest waiting → quote number; unscored last', () => {
    const rows = [
      entry('CCQ-2026-00005', { tier: null, score: null }),
      entry('CCQ-2026-00004', { waitingMs: 10 }),
      entry('CCQ-2026-00003', { waitingMs: 99 }),
      entry('CCQ-2026-00002', { score: 70 }),
      entry('CCQ-2026-00001', { tier: 'critical', score: 90 }),
    ];
    expect(sortFinalReviewQueue(rows, tiers).map((e) => e.quoteNumber)).toEqual([
      'CCQ-2026-00001',
      'CCQ-2026-00002',
      'CCQ-2026-00003',
      'CCQ-2026-00004',
      'CCQ-2026-00005',
    ]);
    // the input is not mutated
    expect(rows[0]?.quoteNumber).toBe('CCQ-2026-00005');
  });

  it('filters by tier, G2 outcome, capital readiness (incl. none), KAM and text', () => {
    const rows = [
      entry('A', {
        tier: 'high',
        g2Outcome: 'capital_required',
        capitalReadiness: 'pending',
        searchText: 'acme erf48213',
      }),
      entry('B', { tier: 'low', capitalReadiness: null, kamUserId: 'k2' }),
      entry('C', { g2Outcome: null }),
    ];
    const names = (f: Parameters<typeof filterFinalReviewQueue>[1]) =>
      filterFinalReviewQueue(rows, f).map((e) => e.quoteNumber);
    expect(names({})).toEqual(['A', 'B', 'C']);
    expect(names({ tiers: ['high'] })).toEqual(['A']);
    expect(names({ g2Outcomes: ['capital_required'] })).toEqual(['A']);
    expect(names({ capitalReadiness: ['none'] })).toEqual(['B']);
    expect(names({ capitalReadiness: ['pending', 'none'] })).toEqual(['A', 'B']);
    expect(names({ kamUserId: 'k2' })).toEqual(['B']);
    expect(names({ q: ' ACME ' })).toEqual(['A']);
    expect(FINAL_REVIEW_FLAGGED_G2).toEqual(['capital_required', 'proceed_with_risk']);
  });
});

describe('review warnings', () => {
  const base = {
    qualification: [],
    quoting: [],
    g2Outcome: 'proceed',
    g2Note: null,
    priceApproved: true,
    capacityEvidenceRows: 1,
    requirement: null,
  };
  const codesOf = (over: Partial<Parameters<typeof reviewWarnings>[0]>) =>
    reviewWarnings({ ...base, ...over }).map((w) => w.code);

  it('is empty for a clean quote', () => {
    expect(reviewWarnings(base)).toEqual([]);
  });

  it('flags a missing price approval, capital required, risk and missing capacity evidence', () => {
    expect(
      codesOf({ priceApproved: false, g2Outcome: 'capital_required', capacityEvidenceRows: 0 }),
    ).toEqual(['PRICE_NOT_APPROVED', 'G2_CAPITAL_REQUIRED', 'CAPACITY_EVIDENCE_MISSING']);
    const risk = reviewWarnings({
      ...base,
      g2Outcome: 'proceed_with_risk',
      g2Note: 'Line 4 is tight',
    });
    expect(risk).toEqual([
      {
        code: 'G2_PROCEED_WITH_RISK',
        severity: 'risk',
        message: 'Engineering proceeded with risk: Line 4 is tight',
      },
    ]);
  });

  it('passes the quoting and qualification warnings through, and says when a tier bars the viewer', () => {
    const out = reviewWarnings({
      ...base,
      quoting: [
        { code: 'CAPITAL_PENDING', message: 'Capital is still pending: board Nov 10' },
        { code: 'COSTING_NOT_ATTESTED', message: 'Costing is not marked as completed' },
      ],
      qualification: [{ code: 'BELOW_MIN_VOLUME', message: 'Below the minimum volume' }],
      requirement: { tierLabel: 'Executive', satisfied: false },
    });
    expect(out.map((w) => [w.code, w.severity])).toEqual([
      ['CAPITAL_PENDING', 'risk'],
      ['COSTING_NOT_ATTESTED', 'risk'],
      ['BELOW_MIN_VOLUME', 'info'],
      ['TIER_APPROVER_REQUIRED', 'risk'],
    ]);
    expect(codesOf({ requirement: { tierLabel: 'Executive', satisfied: true } })).toEqual([]);
  });
});
