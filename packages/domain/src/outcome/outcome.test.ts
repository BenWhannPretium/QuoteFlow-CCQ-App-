import { describe, expect, it } from 'vitest';

import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { CLOSURE_FIELDS, closureErrors, isClosureComplete } from './closure';
import {
  HANDOFF_RECEIVING_ROLES_SEED,
  awardDetailErrors,
  handoffFromAward,
  parseReceivingRoles,
  planHandoff,
  type HandoffValues,
} from './handoff';
import { isSupersededDecision, sortOpenProposals } from './proposals';
import { customerOutcomeKeys, summarizeOutcomes, type OutcomeReportRow } from './report';
import { compareSfStage } from './sf-stage';
import {
  VALIDITY_WARNING_DAYS_SEED,
  calendarDaysBetween,
  isValidityLapsed,
  parseValidityWarningDays,
  quotesToFlagExpired,
  validityStatus,
} from './validity';
import { asUserId } from '../types/ids';
import type { Role } from '../types/roles';
import type { WorkflowConfig } from '../types/workflow-config';
import { availableActions } from '../workflow/available-actions';
import { evaluateTransition, type TransitionRequest } from '../workflow/evaluate';
import { buildHybridConfig, hybridConfig, prd5Config } from '../workflow/seeds';
import { parseWorkflowConfig, validateWorkflowConfig } from '../workflow/validate-config';

const SALES_LEADER = asUserId('user-sales-leader');

/** The role that decides each seeded gate (G5: a SalesLeader, so the KAM default is visible). */
const DECIDER: Record<string, Role> = {
  G1: 'SalesLeader',
  SUBMIT: 'KAM',
  G2: 'EngLead',
  G3: 'PricingLead',
  G4: 'Approver',
  G5: 'SalesLeader',
  G6: 'SalesLeader',
  P_INTAKE: 'KAM',
  P_ENG: 'EngLead',
  P_QUOTE: 'PricingLead',
  P_FINAL: 'Approver',
};

/** Every gate/outcome pair that closes the quote. */
const terminalPaths = (config: WorkflowConfig) =>
  config.transitions
    .filter(
      (t) => t.nextStatus === 'closed' && config.gates.find((g) => g.key === t.gateKey)?.enabled,
    )
    .map((t) => ({ gateKey: t.gateKey, outcomeKey: t.outcomeKey, transition: t }));

function closeCase(config: WorkflowConfig, gateKey: string, outcomeKey: string) {
  const c = validCase(config, gateKey, outcomeKey);
  const quote = makeQuote(c.gate.stageKey, { fields: c.fields });
  const actor = makeActor(DECIDER[gateKey]!, { userId: SALES_LEADER });
  return { c, quote, actor };
}

describe('the closure rule (CR-39/40): every terminal path', () => {
  const configs: [string, WorkflowConfig][] = [
    ['hybrid (G1 on)', hybridConfig],
    ['hybrid (G1 off)', buildHybridConfig({ g1Enabled: false })],
    ['prd5', prd5Config],
  ];

  for (const [name, config] of configs) {
    describe(name, () => {
      const paths = terminalPaths(config);
      it('has terminal paths to sweep', () => {
        expect(paths.length).toBeGreaterThan(0);
      });

      it.each(paths.map((p) => [`${p.gateKey}/${p.outcomeKey}`, p] as const))(
        '%s closes only with outcome + reason + owner + date',
        (_, { gateKey, outcomeKey, transition }) => {
          const { c, quote, actor } = closeCase(config, gateKey, outcomeKey);

          // No reason code: refused, whatever else is right.
          const { reasonCode: _r, ...noReason } = c.request;
          const refused = evaluateTransition(config, quote, actor, noReason, NOW);
          expect(refused.ok).toBe(false);
          expect(!refused.ok && refused.errors.map((e) => e.code)).toContain('REASON_REQUIRED');

          // With a reason: every closure field is filled.
          const done = evaluateTransition(config, quote, actor, c.request, NOW);
          expect(done.ok, JSON.stringify(!done.ok && done.errors)).toBe(true);
          if (!done.ok) return;
          const closure = done.effects.closure!;
          expect(closure).toMatchObject({
            outcome: transition.closeAs,
            outcomeReasonCode: c.request.reasonCode,
            closedAt: NOW,
            decidedBy: actor.userId,
            decidedByRoles: actor.roles,
          });
          expect(closureErrors(closure)).toEqual([]);
          // The owner defaults to the KAM for a customer outcome, else the decider (CR-40).
          expect(closure.closureOwnerId).toBe(
            transition.closureOwner === 'kam' ? quote.kamUserId : actor.userId,
          );
          expect(done.effects.activityEvents.find((e) => e.type === 'quote_closed')).toMatchObject({
            payload: {
              closeAs: transition.closeAs,
              reasonCode: c.request.reasonCode,
              closureOwnerId: closure.closureOwnerId,
            },
          });
        },
      );

      it('non-closing transitions plan no closure', () => {
        for (const t of config.transitions.filter((x) => x.nextStatus !== 'closed')) {
          const c = validCase(config, t.gateKey, t.outcomeKey);
          const result = evaluateTransition(
            config,
            makeQuote(c.gate.stageKey, { fields: c.fields }),
            makeActor(DECIDER[t.gateKey]!),
            c.request,
            NOW,
          );
          if (result.ok) expect(result.effects.closure).toBeUndefined();
        }
      });
    });
  }

  it('the seeded customer outcomes default to the KAM, the internal no-gos to the decider', () => {
    const owners = Object.fromEntries(
      terminalPaths(hybridConfig).map((p) => [
        `${p.gateKey}/${p.outcomeKey}`,
        p.transition.closureOwner,
      ]),
    );
    expect(owners).toEqual({
      'G1/redirect': 'decider',
      'G1/stop': 'decider',
      'G2/stop': 'decider',
      'G3/stop': 'decider',
      'G4/decline': 'decider',
      'G5/lost': 'kam',
      'G5/expired': 'kam',
      // B-26: Won closes at G6; "commitment not authorized" is Pretium's own no-go.
      'G6/advance': 'kam',
      'G6/stop': 'decider',
    });
  });

  it('closureErrors names every empty field', () => {
    expect(
      closureErrors({ outcome: null, outcomeReasonCode: ' ', closureOwnerId: null, closedAt: null })
        .map((e) => e.field)
        .sort(),
    ).toEqual([...CLOSURE_FIELDS].sort());
    expect(
      closureErrors({
        outcome: 'lost',
        outcomeReasonCode: 'price',
        closureOwnerId: KAM_ID,
        closedAt: new Date('nope'),
      }).map((e) => [e.code, e.field]),
    ).toEqual([['CLOSURE_INCOMPLETE', 'closed_at']]);
    expect(
      isClosureComplete({
        status: 'closed',
        outcome: 'lost',
        outcomeReasonCode: null,
        closureOwnerId: 'u',
        closedAt: NOW,
      }),
    ).toBe(false);
    expect(
      isClosureComplete({
        status: 'active',
        outcome: null,
        outcomeReasonCode: null,
        closureOwnerId: null,
        closedAt: null,
      }),
    ).toBe(true);
  });

  it('a config whose closing outcome asks for no reason is refused at load', () => {
    const config = structuredClone(hybridConfig);
    config.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'lost')!.requiresReasonCode = false;
    config.transitions.find((t) => t.gateKey === 'G4' && t.outcomeKey === 'return')!.closureOwner =
      'kam';
    expect(validateWorkflowConfig(config).map((e) => e.message)).toEqual([
      'Transition G4/return sets a closure owner but does not close the quote',
      'Transition G5/lost closes the quote, so its outcome must require a reason code',
    ]);
    expect(() => parseWorkflowConfig(config)).toThrow(/must require a reason code/);
  });

  it('the engine still demands a reason if config ever lets a closing outcome skip one', () => {
    const config = structuredClone(hybridConfig);
    config.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'lost')!.requiresReasonCode = false;
    const result = evaluateTransition(
      config,
      makeQuote('CUSTOMER_DECISION'),
      makeActor('SalesLeader'),
      { gateKey: 'G5', outcomeKey: 'lost' },
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['REASON_REQUIRED']);
  });

  it('a closing transition with no closeAs is refused by the engine, not half-recorded', () => {
    const config = structuredClone(hybridConfig);
    delete config.transitions.find((t) => t.gateKey === 'G5' && t.outcomeKey === 'lost')!.closeAs;
    const result = evaluateTransition(
      config,
      makeQuote('CUSTOMER_DECISION'),
      makeActor('SalesLeader'),
      { gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'price' },
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => [e.code, e.field])).toEqual([
      ['CLOSURE_INCOMPLETE', 'outcome'],
    ]);
  });
});

describe('closure owner (CR-39, D-15: KAM records, sales leader accountable)', () => {
  const lost: TransitionRequest = { gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'price' };
  const quote = makeQuote('CUSTOMER_DECISION');

  it('a SalesLeader may name another owner (themselves, or another user)', () => {
    const leader = makeActor('SalesLeader', { userId: SALES_LEADER });
    for (const owner of [SALES_LEADER, OTHER_ID]) {
      const r = evaluateTransition(
        hybridConfig,
        quote,
        leader,
        { ...lost, closureOwnerId: owner },
        NOW,
      );
      expect(r.ok && r.effects.closure?.closureOwnerId).toBe(owner);
    }
  });

  it('a KAM keeps the default (themselves) and cannot name anyone else', () => {
    const kam = makeActor('KAM', { userId: KAM_ID });
    const self = evaluateTransition(
      hybridConfig,
      quote,
      kam,
      { ...lost, closureOwnerId: KAM_ID },
      NOW,
    );
    expect(self.ok && self.effects.closure?.closureOwnerId).toBe(KAM_ID);
    const other = evaluateTransition(
      hybridConfig,
      quote,
      kam,
      { ...lost, closureOwnerId: OTHER_ID },
      NOW,
    );
    expect(!other.ok && other.errors.map((e) => [e.code, e.field])).toEqual([
      ['NOT_PERMITTED', 'closureOwnerId'],
    ]);
  });

  it('only a closing decision takes an owner', () => {
    const c = validCase(hybridConfig, 'G5', 'on_hold');
    const r = evaluateTransition(
      hybridConfig,
      makeQuote('CUSTOMER_DECISION', { fields: c.fields }),
      makeActor('SalesLeader'),
      { ...c.request, closureOwnerId: KAM_ID },
      NOW,
    );
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['INVALID_CLOSURE_OWNER']);
  });
});

describe('G5 outcomes (B-13)', () => {
  const leader = makeActor('SalesLeader');
  const decide = (request: TransitionRequest, fields: Record<string, unknown> = {}, extra = {}) =>
    evaluateTransition(
      hybridConfig,
      makeQuote('CUSTOMER_DECISION', { fields, ...extra }),
      leader,
      request,
      NOW,
    );
  const codes = (r: ReturnType<typeof decide>) => (r.ok ? [] : r.errors.map((e) => e.code).sort());

  it('offers the six outcomes with the configured reason codes', () => {
    const actions = availableActions(hybridConfig, makeQuote('CUSTOMER_DECISION'), leader);
    expect(actions.map((a) => [a.outcomeKey, a.requiresReasonCode, a.nextStatus])).toEqual([
      // B-26: an award is not spend authority; it moves to Commit & Hand Off.
      ['awarded', true, 'active'],
      ['negotiating', false, 'active'],
      ['lost', true, 'closed'],
      ['expired', true, 'closed'],
      ['on_hold', true, 'on_hold'],
      ['requote', true, 'active'],
    ]);
    const reasons = (key: string) =>
      actions.find((a) => a.outcomeKey === key)!.reasonCodes.map((r) => r.code);
    expect(reasons('awarded')).toEqual(['verbal', 'po', 'loi', 'contract']);
    expect(reasons('lost')).toEqual([
      'price',
      'lead_time',
      'capability',
      'capacity',
      'customer_cancelled',
      'competitor_relationship',
      'other',
    ]);
    expect(reasons('requote')).toEqual([
      'scope_change',
      'volume_change',
      'resin_change',
      'terms_change',
      'other',
    ]);
  });

  it('Awarded needs the acceptance evidence (reason) and its date, and moves to Commit & Hand Off', () => {
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'awarded' }))).toEqual([
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'awarded', reasonCode: 'invoice' }))).toEqual([
      'INVALID_REASON',
      'MISSING_FIELD',
    ]);
    const ok = decide({
      gateKey: 'G5',
      outcomeKey: 'awarded',
      reasonCode: 'po',
      payload: { accepted_at: '2026-10-19' },
    });
    expect(ok.ok && [ok.effects.nextStageKey, ok.effects.nextStatus, ok.effects.closure]).toEqual([
      'COMMIT_HANDOFF',
      'active',
      undefined,
    ]);
  });

  it('B-26: "In negotiation" needs a note and keeps the quote in Customer Decision', () => {
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'negotiating' }))).toEqual(['NOTE_REQUIRED']);
    const r = decide({
      gateKey: 'G5',
      outcomeKey: 'negotiating',
      note: 'Counter at -2%, in range',
    });
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextStatus, r.effects.versionBump]).toEqual([
      'CUSTOMER_DECISION',
      'active',
      false,
    ]);
  });

  it('Lost needs a reason; "Other" also needs a note', () => {
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'lost' }))).toEqual(['REASON_REQUIRED']);
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'other' }))).toEqual([
      'NOTE_REQUIRED',
    ]);
    const r = decide({ gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'other', note: 'Moved' });
    expect(r.ok && r.effects.nextStageKey).toBe('CLOSED_LOST');
  });

  it('Expired is its own state ("silence is not a loss"): after validity, or earlier with a note', () => {
    const expire = { gateKey: 'G5', outcomeKey: 'expired', reasonCode: 'no_response' };
    expect(codes(decide(expire, { validity_lapsed: false }))).toEqual(['MISSING_FIELD']);
    const lapsed = decide(expire, { validity_lapsed: true });
    expect(lapsed.ok && [lapsed.effects.nextStageKey, lapsed.effects.closure?.outcome]).toEqual([
      'EXPIRED',
      'expired',
    ]);
    const noted = decide({ ...expire, note: 'Customer shelved the project' });
    expect(noted.ok && noted.effects.nextStageKey).toBe('EXPIRED');
  });

  it('On hold needs a reason, a review date and an owner (B-26), and starts the hold clock', () => {
    expect(codes(decide({ gateKey: 'G5', outcomeKey: 'on_hold' }))).toEqual([
      'MISSING_FIELD',
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
    const r = decide({
      gateKey: 'G5',
      outcomeKey: 'on_hold',
      reasonCode: 'customer_requested_delay',
      payload: { review_date: '2026-11-30', hold_owner_id: KAM_ID },
    });
    expect(r.ok && [r.effects.nextStatus, r.effects.hold.action, r.effects.closure]).toEqual([
      'on_hold',
      'start',
      undefined,
    ]);
  });

  it('Re-quote needs a change reason and a target, bumps the version, keeps the decision version', () => {
    const base = { gateKey: 'G5', outcomeKey: 'requote' };
    expect(codes(decide(base))).toEqual(['REASON_REQUIRED', 'TARGET_REQUIRED']);
    expect(codes(decide({ ...base, reasonCode: 'other', targetStageKey: 'QUOTING' }))).toEqual([
      'NOTE_REQUIRED',
    ]);
    const r = decide(
      { ...base, reasonCode: 'volume_change', targetStageKey: 'ENG_REVIEW' },
      {},
      { version: 2 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effects).toMatchObject({
      nextStageKey: 'ENG_REVIEW',
      nextVersion: 3,
      versionBump: true,
      gateDecisionRecord: { quoteVersion: 2, reasonCode: 'volume_change' },
    });
  });

  it('a resumed hold: the next decision ends the hold interval', () => {
    const r = decide(
      { gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'price' },
      {},
      {
        status: 'on_hold',
      },
    );
    expect(r.ok && r.effects.hold.action).toBe('end');
  });
});

describe('validity countdown (frozen clock, US Central calendar)', () => {
  // 2026-10-20T15:00Z is 10:00 on Oct 20 in Chicago.
  it.each([
    ['2026-11-19', 30, 'valid'],
    ['2026-10-28', 8, 'valid'],
    ['2026-10-27', 7, 'expiring'],
    ['2026-10-20', 0, 'expiring'],
    ['2026-10-19', -1, 'expired'],
  ] as const)('valid until %s → %i days left (%s)', (until, days, state) => {
    expect(validityStatus(until, NOW)).toEqual({ validityUntil: until, daysLeft: days, state });
  });

  it('counts on the Chicago calendar: late evening Central is still the same day', () => {
    // 2026-10-21T04:30Z = 23:30 on Oct 20 in Chicago: Oct 20 is the last valid day, not past.
    expect(validityStatus('2026-10-20', new Date('2026-10-21T04:30:00Z')).state).toBe('expiring');
    expect(validityStatus('2026-10-20', new Date('2026-10-21T05:30:00Z')).state).toBe('expired');
  });

  it('honours the configured warning window and handles no date', () => {
    expect(validityStatus('2026-10-30', NOW, 14).state).toBe('expiring');
    expect(validityStatus('2026-10-30', NOW, 3).state).toBe('valid');
    expect(validityStatus(null, NOW)).toEqual({
      validityUntil: null,
      daysLeft: null,
      state: 'none',
    });
    expect(isValidityLapsed('2026-10-19', NOW)).toBe(true);
    expect(isValidityLapsed(undefined, NOW)).toBe(false);
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('parses validity_warning_days, failing closed on nonsense', () => {
    expect(parseValidityWarningDays(undefined)).toBe(VALIDITY_WARNING_DAYS_SEED);
    expect(parseValidityWarningDays(null)).toBe(7);
    expect(parseValidityWarningDays(0)).toBe(0);
    for (const bad of [-1, 2.5, '7', 91]) {
      expect(() => parseValidityWarningDays(bad)).toThrow(/validity_warning_days/);
    }
  });
});

describe('expiry job selection (flags, never closes)', () => {
  const row = (over: Partial<Parameters<typeof quotesToFlagExpired>[0][number]> = {}) => ({
    id: 'q',
    quoteNumber: 'CCQ-2026-00001',
    stageKey: 'CUSTOMER_DECISION',
    status: 'active',
    kamUserId: 'k',
    validityUntil: '2026-10-19',
    validityExpiredFlaggedAt: null,
    ...over,
  });

  it('picks open Customer Decision quotes past validity not flagged yet', () => {
    const rows = [
      row({ id: 'lapsed' }),
      row({ id: 'on-hold', status: 'on_hold' }),
      row({ id: 'still-valid', validityUntil: '2026-10-20' }),
      row({ id: 'flagged', validityExpiredFlaggedAt: NOW }),
      row({ id: 'closed', status: 'closed' }),
      row({ id: 'other-stage', stageKey: 'QUOTING' }),
      row({ id: 'no-date', validityUntil: null }),
    ];
    expect(quotesToFlagExpired(rows, NOW).map((r) => r.id)).toEqual(['lapsed', 'on-hold']);
  });
});

describe('Salesforce stage side by side', () => {
  const map = [
    { sfStage: 'Qualifying', ccqStageHint: 'INTAKE' },
    { sfStage: 'Negotiating', ccqStageHint: 'CUSTOMER_DECISION' },
    { sfStage: 'Closed Won – Product Shipping', ccqStageHint: 'AWARDED' },
    { sfStage: 'Closed Lost', ccqStageHint: 'CLOSED_LOST' },
  ];
  const terminal = hybridConfig.stages.filter((s) => s.terminal).map((s) => s.key);
  const cmp = (ccqStageKey: string, sfStage: string | null) =>
    compareSfStage({ ccqStageKey, sfStage, map, terminalStageKeys: terminal });

  it('flags CCQ Customer Decision vs SF Closed Won (and the reverse)', () => {
    expect(cmp('CUSTOMER_DECISION', 'Closed Won – Product Shipping')).toMatchObject({
      ccqStageHint: 'AWARDED',
      mismatch: true,
    });
    expect(cmp('AWARDED', 'Negotiating').mismatch).toBe(true);
    expect(cmp('EXPIRED', 'Closed Lost').mismatch).toBe(true);
  });

  it('agrees, or stays quiet mid-pipeline and for unmapped or missing stages', () => {
    expect(cmp('AWARDED', 'Closed Won – Product Shipping').mismatch).toBe(false);
    // B-26: awarded and waiting on the CER / hand-off agrees with SF's award stages.
    expect(cmp('COMMIT_HANDOFF', 'Closed Won – Product Shipping').mismatch).toBe(false);
    expect(cmp('ENG_REVIEW', 'Qualifying').mismatch).toBe(false);
    expect(cmp('CUSTOMER_DECISION', 'Something new')).toMatchObject({
      ccqStageHint: null,
      mismatch: false,
    });
    expect(cmp('CUSTOMER_DECISION', null)).toEqual({
      sfStage: null,
      ccqStageHint: null,
      mismatch: false,
      reason: null,
    });
  });

  it('explains the mismatch with stage labels', () => {
    const r = compareSfStage({
      ccqStageKey: 'CUSTOMER_DECISION',
      sfStage: 'Closed Won – Product Shipping',
      map,
      terminalStageKeys: terminal,
      stageLabel: (k) => hybridConfig.stages.find((s) => s.key === k)!.label,
    });
    expect(r.reason).toBe(
      'CCQ shows Customer Decision but Salesforce shows "Closed Won – Product Shipping" (Closed – Won)',
    );
  });
});

describe('outcomes report', () => {
  const closed = (outcome: string, reason: string, stageKey: string): OutcomeReportRow => ({
    stageKey,
    status: 'closed',
    outcome,
    outcomeReasonCode: reason,
    closureOwnerId: 'u',
    closedAt: NOW,
    proposalIssuedAt: new Date('2026-09-01T15:00:00Z'),
    validityUntil: '2026-10-01',
  });
  const open = (validityUntil: string | null): OutcomeReportRow => ({
    stageKey: 'CUSTOMER_DECISION',
    status: 'active',
    outcome: null,
    outcomeReasonCode: null,
    closureOwnerId: null,
    closedAt: null,
    proposalIssuedAt: new Date('2026-09-20T15:00:00Z'),
    validityUntil,
  });
  const rows: OutcomeReportRow[] = [
    closed('awarded', 'po', 'AWARDED'),
    closed('awarded', 'verbal', 'AWARDED'),
    closed('awarded', 'po', 'AWARDED'),
    closed('lost', 'price', 'CLOSED_LOST'),
    closed('expired', 'no_response', 'EXPIRED'),
    closed('expired', 'no_response', 'EXPIRED'),
    { ...closed('declined', 'other', 'DECLINED'), proposalIssuedAt: null, validityUntil: null },
    open('2026-10-19'), // gone dark
    open('2026-11-19'), // awaiting
    {
      ...open(null),
      stageKey: 'QUOTING',
      proposalIssuedAt: null,
    },
  ];

  it('keeps expired apart from lost, everywhere', () => {
    const r = summarizeOutcomes(rows, hybridConfig, NOW);
    expect(r.customer).toEqual({
      awarded: 3,
      lost: 1,
      expired: 2,
      commitmentPending: 0,
      winRate: 0.75,
    });
    const byKey = Object.fromEntries(r.outcomes.map((o) => [o.outcome, o]));
    expect(byKey.lost).toMatchObject({ kind: 'customer', count: 1, label: 'Closed Lost' });
    expect(byKey.expired).toMatchObject({
      kind: 'customer',
      count: 2,
      label: 'Expired',
      reasons: [{ code: 'no_response', label: 'No customer response', count: 2 }],
    });
    expect(byKey.awarded!.reasons).toEqual([
      { code: 'po', label: 'Purchase order (PO)', count: 2 },
      { code: 'verbal', label: 'Verbal award', count: 1 },
    ]);
    expect(byKey.declined).toMatchObject({ kind: 'internal', count: 1 });
    // Every configured closure is listed (0 when unused), customer outcomes first.
    expect(byKey.redirected).toMatchObject({ kind: 'internal', count: 0, reasons: [] });
    expect(r.outcomes.slice(0, 3).map((o) => o.kind)).toEqual(['customer', 'customer', 'customer']);
  });

  it('capture rate: recorded customer outcomes over recorded + gone dark', () => {
    const r = summarizeOutcomes(rows, hybridConfig, NOW);
    expect(r.capture).toEqual({
      proposalsIssued: 8,
      recorded: 6,
      awaiting: 1,
      goneDark: 1,
      rate: 0.857,
    });
    expect(r.incompleteClosures).toBe(0);
    const none = summarizeOutcomes([], hybridConfig, NOW);
    expect([none.capture.rate, none.customer.winRate]).toEqual([null, null]);
  });

  it('counts closures that break the rule (legacy rows) instead of hiding them', () => {
    const r = summarizeOutcomes(
      [{ ...closed('lost', 'price', 'CLOSED_LOST'), outcome: null, outcomeReasonCode: null }],
      hybridConfig,
      NOW,
    );
    expect(r.incompleteClosures).toBe(1);
    expect(r.outcomes.find((o) => o.outcome === 'unrecorded')).toMatchObject({
      outcome: 'unrecorded',
      label: 'No outcome recorded',
      reasons: [{ code: null, label: 'No reason recorded', count: 1 }],
    });
  });

  it('customer outcomes: G5 closures and the KAM-owned G6 closure (Won), not G6 "not authorized"', () => {
    expect([...customerOutcomeKeys(hybridConfig)].sort()).toEqual(['awarded', 'expired', 'lost']);
  });

  it('B-26: an award waiting in Commit & Hand Off counts as a win and as recorded', () => {
    const pending: OutcomeReportRow = { ...open(null), stageKey: 'COMMIT_HANDOFF' };
    const r = summarizeOutcomes([...rows, pending], hybridConfig, NOW);
    expect(r.customer).toMatchObject({ awarded: 4, commitmentPending: 1, winRate: 0.8 });
    expect(r.capture).toMatchObject({ recorded: 7, proposalsIssued: 9 });
    expect(r.outcomes.find((o) => o.outcome === 'not_authorized')).toMatchObject({
      kind: 'internal',
      count: 0,
    });
  });
});

describe('hand-off record (Stage 6, minimal)', () => {
  const roles = HANDOFF_RECEIVING_ROLES_SEED;
  const award = handoffFromAward({
    reasonCode: 'po',
    acceptedAt: '2026-10-19',
    acceptanceDocumentUrl: 'https://sharepoint.example/po.pdf',
  })!;
  const plan = (
    edit: Parameters<typeof planHandoff>[0]['edit'],
    current: HandoffValues | null = award,
    stageKey = 'AWARDED',
  ) =>
    planHandoff({ stageKey, current, edit, actorId: 'user-kam', now: NOW, receivingRoles: roles });

  it('starts from the Awarded decision (evidence, date, link)', () => {
    expect(award).toMatchObject({
      acceptanceEvidence: 'po',
      acceptanceDate: '2026-10-19',
      acceptanceDocumentUrl: 'https://sharepoint.example/po.pdf',
      completedAt: null,
    });
    expect(
      handoffFromAward({ reasonCode: 'price', acceptedAt: null, acceptanceDocumentUrl: null }),
    ).toBeNull();
  });

  it('only on an AWARDED quote', () => {
    const r = plan({ cerId: 'CER-1' }, award, 'CUSTOMER_DECISION');
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['NOT_AWARDED']);
  });

  it('captures the CER and the receiving role (B-26: no BPR); only the keys sent change', () => {
    const r = plan({
      cerId: ' CER-2026-0412 ',
      receivingRole: 'commercial_activation',
      receivingContactName: 'Amanda Cronkhite',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toMatchObject({
      acceptanceEvidence: 'po',
      acceptanceDate: '2026-10-19',
      cerId: 'CER-2026-0412',
      cerStatus: 'pending',
      cerApprovedOn: null,
      receivingRole: 'commercial_activation',
      receivingContactName: 'Amanda Cronkhite',
    });
    expect(r.values).not.toHaveProperty('bprId');
    expect(r.changed.sort()).toEqual(['cerId', 'receivingContactName', 'receivingRole']);
    expect(r.completion).toBeNull();
  });

  it('B-26 (G6a): an approved CER needs its ID and approval date; other statuses clear the date', () => {
    const missing = plan({ cerStatus: 'approved' });
    expect(!missing.ok && missing.errors.map((e) => e.field).sort()).toEqual([
      'cerApprovedOn',
      'cerId',
    ]);
    const future = plan({ cerStatus: 'approved', cerId: 'CER-1', cerApprovedOn: '2026-12-01' });
    expect(!future.ok && future.errors.map((e) => e.field)).toEqual(['cerApprovedOn']);
    const ok = plan({ cerStatus: 'approved', cerId: 'CER-1', cerApprovedOn: '2026-10-19' });
    expect(ok.ok && [ok.values.cerStatus, ok.values.cerApprovedOn]).toEqual([
      'approved',
      '2026-10-19',
    ]);
    const bad = plan({ cerStatus: 'maybe' });
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual(['cerStatus']);
    expect(plan({ cerStatus: 'not_required' }).ok).toBe(true);
  });

  it('B-26: editable in Commit & Hand Off and on Closed – Won, nowhere else', () => {
    for (const [stageKey, ok] of [
      ['COMMIT_HANDOFF', true],
      ['AWARDED', true],
      ['CUSTOMER_DECISION', false],
    ] as const) {
      const r = planHandoff({
        stageKey,
        current: award,
        edit: { notes: 'x' },
        actorId: 'user-kam',
        now: NOW,
        receivingRoles: roles,
      });
      expect(r.ok, stageKey).toBe(ok);
    }
  });

  it('validates evidence, role, references, dates and the link', () => {
    const r = plan({
      acceptanceEvidence: 'email',
      receivingRole: 'sales',
      cerId: 'CER<script>',
      acceptedOn: '2026-12-01',
      acceptanceDocumentUrl: 'javascript:alert(1)',
    });
    expect(!r.ok && r.errors.map((e) => e.field).sort()).toEqual([
      'acceptanceDocumentUrl',
      'acceptanceEvidence',
      'acceptedOn',
      'cerId',
      'receivingRole',
    ]);
    expect(plan({ acceptedOn: '2026-02-30x' }).ok).toBe(false);
  });

  it('"Hand-off complete" needs role, contact and accepted-by date, and records who and when', () => {
    const missing = plan({ complete: true, receivingRole: 'other' });
    expect(!missing.ok && missing.errors.map((e) => e.field).sort()).toEqual([
      'acceptedOn',
      'receivingContactName',
      'receivingRoleOther',
    ]);
    const done = plan({
      complete: true,
      receivingRole: 'npi_post_award_pm',
      receivingContactName: 'Pat Doe',
      acceptedOn: '2026-10-20',
    });
    expect(done.ok && [done.completion, done.values.completedBy, done.values.completedAt]).toEqual([
      'completed',
      'user-kam',
      NOW,
    ]);
    if (!done.ok) return;
    // Editing later keeps who confirmed it; unticking re-opens it.
    const later = planHandoff({
      stageKey: 'AWARDED',
      current: done.values,
      edit: { notes: 'PO 4471 received' },
      actorId: 'user-admin',
      now: new Date(NOW.getTime() + 3_600_000),
      receivingRoles: roles,
    });
    expect(later.ok && [later.completion, later.values.completedBy]).toEqual([null, 'user-kam']);
    const reopened = plan({ complete: false }, done.values);
    expect(reopened.ok && [reopened.completion, reopened.values.completedAt]).toEqual([
      'reopened',
      null,
    ]);
  });

  it('drops the "other" team name when the role is not other', () => {
    const r = plan({ receivingRole: 'commercial_activation', receivingRoleOther: 'Ops' });
    expect(r.ok && r.values.receivingRoleOther).toBeNull();
  });

  it('checks the Awarded decision’s own date and link', () => {
    expect(awardDetailErrors({ acceptedAt: '2026-10-20' }, NOW)).toEqual([]);
    expect(
      awardDetailErrors({ acceptedAt: '2026-10-21', acceptanceDocumentUrl: 'ftp://x' }, NOW).map(
        (e) => e.field,
      ),
    ).toEqual(['acceptedAt', 'acceptanceDocumentUrl']);
  });

  it('parses handoff_receiving_roles', () => {
    expect(parseReceivingRoles(undefined)).toEqual(roles);
    expect(parseReceivingRoles([{ code: 'x', label: 'X' }])).toEqual([{ code: 'x', label: 'X' }]);
    for (const bad of [[], 'x', [{ code: '', label: 'X' }], [{ code: 'x' }]]) {
      expect(() => parseReceivingRoles(bad)).toThrow(/handoff_receiving_roles/);
    }
  });
});

describe('my open proposals and superseded decisions', () => {
  it('sorts by validity end, soonest first, no date last', () => {
    const items = [
      { quoteNumber: 'CCQ-2026-00003', validityUntil: '2026-11-01' },
      { quoteNumber: 'CCQ-2026-00002', validityUntil: null },
      { quoteNumber: 'CCQ-2026-00004', validityUntil: '2026-10-25' },
      { quoteNumber: 'CCQ-2026-00001', validityUntil: '2026-11-01' },
    ];
    expect(sortOpenProposals(items).map((i) => i.quoteNumber)).toEqual([
      'CCQ-2026-00004',
      'CCQ-2026-00001',
      'CCQ-2026-00003',
      'CCQ-2026-00002',
    ]);
  });

  it('a decision on an earlier version is superseded (kept, never edited)', () => {
    expect(isSupersededDecision(1, 2)).toBe(true);
    expect(isSupersededDecision(2, 2)).toBe(false);
  });
});
