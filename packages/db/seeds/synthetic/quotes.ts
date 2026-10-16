import { asUserId, evaluateTransition, score } from '@ccq/domain';
import type { Actor, ScoringModel, TransitionRequest, WorkflowConfig } from '@ccq/domain';

import type { SyntheticOpportunity } from './opportunities';
import type { Persona, PersonaKey } from './personas';
import type { Rng } from './rng';
import { DAY_MS } from './rng';
import type { DbOrTx } from '../../src/client';
import {
  insertAttachment,
  insertAuditEvent,
  insertCapacityEvidence,
  insertComment,
  insertHandoffRecord,
  insertOverride,
  insertQuote,
  loadQuoteState,
  loadScoringFacts,
  nextQuoteNumber,
  persistTransition,
  setQuotePriority,
  updateQuote,
  upsertEngReview,
  upsertPricingRecord,
} from '../../src/repos/index';
import { activityEvent, stageHistory } from '../../src/schema/index';

/** Final stage → how many of the 150 quotes end there. Every stage is covered. */
/**
 * B-07: at most one active (not closed) quote per SF opportunity, so the 80 active quotes take 80
 * distinct opportunities and leave open ones free for new intakes. Closed quotes may share an
 * opportunity (an earlier Lost / Expired attempt before the current one).
 */
export const QUOTE_STAGE_TARGETS: [stage: string, count: number][] = [
  ['INTAKE', 12],
  ['ENG_REVIEW', 22],
  ['QUOTING', 18],
  ['FINAL_REVIEW', 10],
  ['CUSTOMER_DECISION', 18],
  ['AWARDED', 22],
  ['CLOSED_LOST', 18],
  ['DECLINED', 8],
  ['EXPIRED', 12],
  ['REDIRECTED', 10],
];

/** Stages whose quotes end the seed closed (terminal). */
const CLOSED_STAGES = new Set(['AWARDED', 'CLOSED_LOST', 'DECLINED', 'EXPIRED', 'REDIRECTED']);

type Who = PersonaKey | 'kam' | 'g1' | 'g4';

type Step =
  | {
      kind: 'decide';
      gate: string;
      outcome: string;
      who: Who;
      note?: string;
      reason?: string;
      target?: string;
      payload?: Record<string, unknown>;
      hold?: boolean;
    }
  | { kind: 'assign' }
  | { kind: 'engineering'; capital?: boolean }
  | { kind: 'pricing' }
  | { kind: 'proposal' }
  | { kind: 'handoff' };

const d = (
  gate: string,
  outcome: string,
  who: Who,
  extra: Partial<Extract<Step, { kind: 'decide' }>> = {},
): Step => ({
  kind: 'decide',
  gate,
  outcome,
  who,
  ...extra,
});

const g1 = (outcome = 'advance', extra = {}) => d('G1', outcome, 'g1', extra);
const g2 = (outcome = 'proceed', extra = {}) => d('G2', outcome, 'eng-lead', extra);
const g3 = (outcome = 'submit', extra = {}) => d('G3', outcome, 'pricing', extra);
const g4 = (outcome = 'approve', extra = {}) => d('G4', outcome, 'g4', extra);
const g5 = (outcome: string, extra = {}) => d('G5', outcome, 'kam', extra);

/** The decision paths that bring a quote to its final stage, with holds and returns sprinkled in. */
function scenario(rng: Rng, stage: string, i: number): { steps: Step[]; complete: boolean } {
  const g2Outcome = rng.pick(['proceed', 'proceed', 'proceed_with_risk', 'capital_required']);
  const g2Extra =
    g2Outcome === 'proceed_with_risk'
      ? { note: 'Cycle time unproven on this neck finish; trial needed.' }
      : {};
  const toEng: Step[] = [g1()];
  const engWork: Step[] = [
    { kind: 'assign' },
    { kind: 'engineering', capital: g2Outcome === 'capital_required' },
  ];
  const toQuoting: Step[] = [...toEng, ...engWork, g2(g2Outcome, g2Extra)];
  const toFinal: Step[] = [...toQuoting, { kind: 'pricing' }, g3()];
  const toCustomer: Step[] = [...toFinal, g4(), { kind: 'proposal' }];
  const hold = (gate: string) =>
    d(
      gate,
      gate === 'G5' ? 'on_hold' : 'hold',
      gate === 'G1' ? 'g1' : gate === 'G2' ? 'eng-lead' : gate === 'G3' ? 'pricing' : 'kam',
      {
        reason: rng.pick([
          'awaiting_customer_info',
          'awaiting_capital_decision',
          'awaiting_internal_input',
          'customer_requested_delay',
        ]),
        hold: true,
      },
    );

  switch (stage) {
    case 'INTAKE':
      if (i < 6) return { steps: [], complete: i % 3 !== 0 }; // awaiting G1, some incomplete
      if (i < 9) return { steps: [hold('G1')], complete: true };
      return {
        steps: [
          g1('rework', {
            note: 'Need annual volume by SKU and the target neck finish.',
            reason: 'missing_information',
          }),
        ],
        complete: true,
      };
    case 'ENG_REVIEW':
      if (i < 7) return { steps: toEng, complete: true }; // waiting in the queue
      if (i < 16) return { steps: [...toEng, ...engWork], complete: true };
      if (i < 19) return { steps: [...toEng, ...engWork, hold('G2')], complete: true };
      return {
        steps: [
          ...toEng,
          { kind: 'assign' },
          g2('rework', {
            note: 'Drawing shows a different finish than requested; please confirm.',
            reason: 'wrong_specification',
          }),
          g1(),
        ],
        complete: true,
      };
    case 'QUOTING':
      if (i < 12) return { steps: toQuoting, complete: true };
      if (i < 15) return { steps: [...toQuoting, hold('G3')], complete: true };
      return {
        steps: [
          ...toQuoting,
          g3('rework', {
            note: 'Capital estimate excludes downstream trimmer; please revise.',
            reason: 'missing_information',
          }),
          g2('proceed'),
        ],
        complete: true,
      };
    case 'FINAL_REVIEW':
      if (i < 8) return { steps: toFinal, complete: true };
      return {
        steps: [
          ...toFinal,
          g4('return', {
            note: 'Validity terms missing from the proposal draft.',
            target: 'QUOTING',
            reason: 'missing_information',
          }),
          g3(),
        ],
        complete: true,
      };
    case 'CUSTOMER_DECISION':
      if (i < 10) return { steps: toCustomer, complete: true };
      if (i < 15) return { steps: [...toCustomer, hold('G5')], complete: true };
      return {
        steps: [
          ...toCustomer,
          g5('requote', { reason: 'volume_change', target: 'QUOTING' }),
          { kind: 'pricing' },
          g3(),
          g4(),
          { kind: 'proposal' },
        ],
        complete: true,
      };
    case 'AWARDED':
      return {
        steps: [
          ...toCustomer,
          ...(i % 5 === 0 ? [hold('G5')] : []),
          g5('awarded'),
          { kind: 'handoff' },
        ],
        complete: true,
      };
    case 'CLOSED_LOST':
      if (i < 4)
        return {
          steps: [...toEng, ...engWork, g2('stop', { reason: 'customer_withdrew' })],
          complete: true,
        };
      if (i < 6)
        return {
          steps: [
            ...toCustomer,
            g5('lost', {
              reason: 'other',
              note: 'Customer moved the program to an in-house line.',
            }),
          ],
          complete: true,
        };
      return {
        steps: [
          ...toCustomer,
          g5('lost', {
            reason: rng.pick([
              'price',
              'price',
              'lead_time',
              'capability',
              'capacity',
              'customer_cancelled',
              'competitor_relationship',
            ]),
          }),
        ],
        complete: true,
      };
    case 'DECLINED':
      // A G1 Stop closes as DECLINED (B-08); the rest are Final Review declines.
      if (i < 2)
        return {
          steps: [
            g1('stop', {
              reason: rng.pick(['below_minimum_threshold', 'not_strategic', 'duplicate']),
              note: 'Not a fit for a new mold set at this volume.',
            }),
          ],
          complete: true,
        };
      return {
        steps: [
          ...toFinal,
          g4('decline', {
            note: 'Margin at the approved price does not cover the capital payback.',
            reason: rng.pick([
              'margin_below_floor',
              'capacity_unavailable',
              'capital_not_approved',
              'strategic_misfit',
            ]),
          }),
        ],
        complete: true,
      };
    case 'EXPIRED':
      return {
        steps: [
          ...toCustomer,
          g5('expired', { reason: rng.pick(['no_response', 'validity_lapsed']) }),
        ],
        complete: true,
      };
    case 'REDIRECTED':
      return {
        steps: [
          g1('redirect', {
            reason: rng.pick(['stock_item', 'price_inquiry', 'other_capital_route']),
          }),
        ],
        complete: true,
      };
    default:
      throw new Error(`no scenario for ${stage}`);
  }
}

const RESIN_CODE: Record<string, string> = { 'PCR-HDPE': 'PCR_HDPE', 'PCR-PET': 'PCR_PET' };
const NECK_CODE: Record<string, string> = { '120 DC': '120-DC' };
const PROCESS_FOR: Record<string, string[]> = {
  BOTTLE: ['EBM', 'ISBM', 'IBM'],
  JAR: ['ISBM', 'IBM', 'EBM'],
  HANDLEWARE: ['EBM'],
  CANISTER_TUB: ['IMM', 'EBM'],
  PREFORM: ['IMM_PREFORM'],
};

/** SF opportunity owner (and so the quote's KAM) per customer region. */
export const KAM_BY_REGION = {
  West: 'kam-region',
  East: 'kam-owner',
  Central: 'kam',
} as const satisfies Record<string, PersonaKey>;

export interface QuoteGenContext {
  db: DbOrTx;
  rng: Rng;
  anchor: Date;
  config: WorkflowConfig;
  scoring: ScoringModel;
  personas: Map<PersonaKey, Persona>;
  opportunities: SyntheticOpportunity[];
  validityDays: number;
}

export interface QuoteGenResult {
  quotes: number;
  byStage: Record<string, number>;
}

/**
 * 150 quotes. Each starts in INTAKE and is walked to its final stage through the real domain
 * engine (`evaluateTransition`) and the same persistence the API uses (`persistTransition`),
 * so stage history, gate decisions, holds, versions and closures are consistent by construction.
 */
export async function generateQuotes(ctx: QuoteGenContext): Promise<QuoteGenResult> {
  const { db, rng, anchor, config, personas } = ctx;
  const persona = (key: PersonaKey) => personas.get(key)!;
  const actorOf = (p: Persona): Actor => ({
    userId: asUserId(p.id),
    roles: p.roles,
    scope: p.scope,
  });
  const engineers = [persona('engineer'), persona('engineer-owner')];

  // Closed-won / lost SF opportunities go to quotes with matching outcomes first.
  // Active quotes (not closed) each take a distinct open opportunity; closed quotes reuse them.
  const won = ctx.opportunities.filter((o) => /PO\(s\)|Verbal|Closed Won/.test(o.sfStage));
  const lost = ctx.opportunities.filter((o) => o.sfStage === 'Closed Lost');
  const open = ctx.opportunities.filter((o) => !won.includes(o) && !lost.includes(o));
  let openCursor = 0;
  const nextFreeOpen = () => {
    const opp = open[openCursor++];
    if (!opp) throw new Error('synthetic seed: more active quotes than open SF opportunities');
    return opp;
  };
  // Closed quotes pass through active states while they are walked, so they only reuse the open
  // opportunities no active quote takes (each closes before the next one starts).
  const activeTotal = QUOTE_STAGE_TARGETS.filter(([stage]) => !CLOSED_STAGES.has(stage)).reduce(
    (n, [, count]) => n + count,
    0,
  );
  const spare = open.slice(activeTotal);
  if (spare.length === 0) throw new Error('synthetic seed: no spare open SF opportunities');
  let reuseCursor = 0;
  const nextReused = () => spare[reuseCursor++ % spare.length]!;

  // Plan every quote (scenario + timeline) first, then create them in time order so quote numbers
  // are chronological.
  const plan = rng
    .shuffle(
      QUOTE_STAGE_TARGETS.flatMap(([stage, n]) =>
        Array.from({ length: n }, (_, i) => ({ stage, i })),
      ),
    )
    .map(({ stage, i }) => {
      const opp =
        stage === 'AWARDED' && won.length > 0
          ? won.shift()!
          : stage === 'CLOSED_LOST' && lost.length > 0
            ? lost.shift()!
            : CLOSED_STAGES.has(stage)
              ? nextReused()
              : nextFreeOpen();
      const { steps, complete } = scenario(rng, stage, i);
      // Lay out the timeline backwards from the anchor so every event is in the past.
      const gaps = steps.map(
        (s) =>
          (s.kind === 'decide' && s.hold ? rng.int(5, 20) : rng.int(1, 8)) * DAY_MS +
          rng.int(0, 8) * 3_600_000,
      );
      const tail = rng.int(0, 10) * DAY_MS + rng.int(1, 20) * 3_600_000;
      const createdAt = new Date(
        anchor.getTime() - gaps.reduce((a, b) => a + b, 0) - tail - rng.int(1, 5) * DAY_MS,
      );
      return { stage, i, opp, steps, complete, gaps, createdAt };
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const byStage: Record<string, number> = {};
  let ordinal = 0;

  for (const { stage, i, opp, steps, complete, gaps, createdAt } of plan) {
    ordinal++;

    // The quote's KAM is the SF opportunity owner: West → region-scoped KAM, East → owner-scoped KAM.
    const kam = persona(KAM_BY_REGION[opp.customer.region]);
    let at = createdAt;

    rng.int(18, 96); // was the random score before B-08; kept so the rest of the data stays the same
    const productFamily = opp.spec.productFamily;
    const quoteRow = await insertQuote(db, {
      id: rng.uuid(createdAt),
      quoteNumber: await nextQuoteNumber(db, createdAt),
      sfOpportunityId: opp.sfOpportunityId,
      customerId: complete || i % 2 === 0 ? opp.customer.id : null,
      kamUserId: kam.id,
      region: opp.customer.region,
      stageKey: 'INTAKE',
      status: 'active',
      version: 1,
      description: `${opp.spec.sizeOz}oz ${opp.spec.resin} ${opp.spec.shape}, ${opp.spec.neck} finish. Synthetic request.`,
      structuredDescription: {
        sizeOz: opp.spec.sizeOz,
        shape: opp.spec.shape,
        finish: opp.spec.neck,
      },
      productFamily,
      market: opp.spec.market,
      resin: complete ? (RESIN_CODE[opp.spec.resin] ?? opp.spec.resin) : null,
      components: rng.chance(0.4) ? ['CONTAINER', 'CLOSURE'] : ['CONTAINER'],
      estAnnualVolume: complete ? rng.int(50, 6_000) * 1_000 : null,
      estAnnualRevenue:
        complete && rng.chance(0.8) ? Math.round(opp.amount * rng.float(0.8, 1.6)) : null,
      expectedCloseDate: opp.closeDate,
      drawingStatus: rng.pick(['HAVE_DRAWING', 'HAVE_DRAWING', 'COMING', 'SAMPLE_ONLY', 'NONE']),
      neckFinish: NECK_CODE[opp.spec.neck] ?? opp.spec.neck,
      packagingType: rng.pick(['BULK', 'BAGGED', 'TRAYED', 'PALLETIZED_CUSTOM']),
      packagingNotes: rng.chance(0.3) ? 'Max pallet height 96 in; corner boards required.' : null,
      requestClass: 'CCQ',
      commentsForEngineering: rng.chance(0.5)
        ? 'Customer wants lightweighting options explored.'
        : null,
      shipTo: opp.customer.shipTo,
      shipToOverridden: rng.chance(0.1),
      submittedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      createdBy: kam.id,
    });
    const quoteId = quoteRow.id;
    await db.insert(stageHistory).values({
      quoteId,
      stageKey: 'INTAKE',
      enteredAt: createdAt,
      enteredBy: kam.id,
      createdAt,
      createdBy: kam.id,
    });
    await db.insert(activityEvent).values({
      quoteId,
      type: 'quote_created',
      actorId: kam.id,
      at: createdAt,
      payload: { sfOpportunityId: opp.sfOpportunityId },
      createdAt,
      createdBy: kam.id,
    });
    await insertAuditEvent(db, {
      at: createdAt,
      actorId: kam.id,
      actorRoles: [...kam.roles],
      action: 'create',
      entity: 'quote',
      entityId: quoteId,
      quoteId,
      after: { quoteNumber: quoteRow.quoteNumber },
      createdAt,
      createdBy: kam.id,
    });

    let engineer: Persona | undefined;
    for (const [s, step] of steps.entries()) {
      at = new Date(at.getTime() + gaps[s]!);
      switch (step.kind) {
        case 'assign': {
          engineer = rng.pick(engineers);
          await updateQuote(db, quoteId, {
            assignedEngineerId: engineer.id,
            queuePosition: rng.int(1, 30),
          });
          await upsertEngReview(db, {
            quoteId,
            acceptedAt: at,
            createdAt: at,
            createdBy: persona('eng-lead').id,
          });
          await insertAuditEvent(db, {
            at,
            actorId: persona('eng-lead').id,
            actorRoles: ['EngLead'],
            action: 'update',
            entity: 'quote',
            entityId: quoteId,
            quoteId,
            after: { assignedEngineerId: engineer.id },
            createdAt: at,
          });
          break;
        }
        case 'engineering': {
          const analyst = engineer ?? persona('engineer');
          const processType = rng.pick(PROCESS_FOR[productFamily] ?? ['OTHER']);
          await upsertEngReview(db, {
            quoteId,
            acceptedAt: at,
            processType,
            machineType: rng.pick([
              'EBM_SHUTTLE',
              'EBM_WHEEL',
              'IBM_PRESS',
              'ISBM_1STEP',
              'ISBM_2STEP',
              'INJECTION_PRESS',
            ]),
            plantCode: rng.pick(['PLANT_01', 'PLANT_02', 'PLANT_03']),
            cavitation: rng.pick([2, 4, 6, 8, 12, 16]),
            cycleTimeS: rng.float(6, 28, 1),
            toolingNotes: rng.chance(0.5)
              ? 'New mould set required; existing base cups reusable.'
              : null,
            prelimCapitalUsd: step.capital || rng.chance(0.4) ? rng.int(40, 900) * 1_000 : null,
            downstreamEquipmentNotes: rng.chance(0.3) ? 'Needs leak tester and flamer.' : null,
          });
          const evidenceCount = rng.chance(0.25) ? 2 : 1;
          for (let k = 0; k < evidenceCount; k++) {
            await insertCapacityEvidence(db, {
              quoteId,
              site: rng.pick(['PLANT_01', 'PLANT_02', 'PLANT_03']),
              lineAsset: `Line ${rng.int(1, 12)}`,
              assumedEffectivenessPct: rng.float(60, 85, 1),
              cycleTimeS: rng.float(6, 28, 1),
              utilizationPct: rng.float(35, 95, 1),
              bufferPct: rng.chance(0.7) ? rng.float(5, 20, 1) : null,
              analysisDate: at.toISOString().slice(0, 10),
              analystId: analyst.id,
              notes: 'Assumptions stated by the analyst; no OEE default applied.',
              createdAt: at,
              createdBy: analyst.id,
            });
          }
          break;
        }
        case 'pricing': {
          const pricing = persona('pricing');
          await upsertPricingRecord(db, {
            quoteId,
            priceApprovedBy: pricing.id,
            priceApprovedAt: at,
            pricingRefs: {
              erf: `ERF-${rng.int(10_000, 99_999)}`,
              bpr: rng.chance(0.3) ? `BPR-${rng.int(1_000, 9_999)}` : null,
            },
            approvedRangeNote: 'Approved within the pricing-app range (synthetic).',
            capitalReadiness: rng.pick(['not_required', 'pending', 'pre_approved', 'pre_approved']),
            capitalNotes: rng.chance(0.3) ? 'CER to be raised on award.' : null,
            createdAt: at,
            createdBy: pricing.id,
          });
          await updateQuote(db, quoteId, { erfNumber: `ERF-${rng.int(10_000, 99_999)}` });
          break;
        }
        case 'proposal': {
          const validity = new Date(at.getTime() + ctx.validityDays * DAY_MS);
          await updateQuote(db, quoteId, {
            proposalIssuedAt: at,
            validityUntil: validity.toISOString().slice(0, 10),
          });
          break;
        }
        case 'handoff': {
          const cer = rng.chance(0.6) ? `CER-${rng.int(1_000, 9_999)}` : null;
          await insertHandoffRecord(db, {
            quoteId,
            acceptanceEvidence: rng.pick(['verbal', 'po', 'po', 'loi', 'contract']),
            receivingRole: 'PostAward',
            acceptedByName: rng.faker.person.fullName(),
            cerId: cer,
            bprId: rng.chance(0.5) ? `BPR-${rng.int(1_000, 9_999)}` : null,
            notes: 'Synthetic hand-off.',
            createdAt: at,
            createdBy: kam.id,
          });
          if (cer) await updateQuote(db, quoteId, { cerId: cer });
          break;
        }
        case 'decide': {
          const decider =
            step.who === 'kam'
              ? kam
              : step.who === 'g1'
                ? persona(rng.chance(0.8) ? 'sales-leader' : 'multi-role')
                : step.who === 'g4'
                  ? persona(rng.chance(0.8) ? 'approver' : 'multi-role')
                  : persona(step.who);
          const state = await loadQuoteState(db, quoteId);
          if (step.gate === 'G1' && state?.fields.submitted_at == null) {
            // The KAM resubmitted the reworked intake before this decision.
            await updateQuote(db, quoteId, { submittedAt: at });
            state!.fields = { ...state!.fields, submitted_at: at };
          }
          const payload =
            step.payload ??
            (step.hold
              ? { review_date: new Date(at.getTime() + 21 * DAY_MS).toISOString().slice(0, 10) }
              : undefined);
          if (payload?.review_date)
            await updateQuote(db, quoteId, { reviewDate: payload.review_date as string });
          const request: TransitionRequest = {
            gateKey: step.gate,
            outcomeKey: step.outcome,
            ...(step.note ? { note: step.note } : {}),
            ...(step.reason ? { reasonCode: step.reason } : {}),
            ...(step.target ? { targetStageKey: step.target } : {}),
            ...(payload ? { payload } : {}),
          };
          const result = evaluateTransition(config, state!, actorOf(decider), request, at);
          if (!result.ok) {
            throw new Error(
              `synthetic ${quoteRow.quoteNumber} ${step.gate}/${step.outcome}: ${result.errors.map((e) => e.message).join('; ')}`,
            );
          }
          await persistTransition(db, result.effects, {
            actorRoles: decider.roles,
            requestId: 'synthetic-seed',
          });
          break;
        }
      }
    }

    // Advisory priority score from the real engine, as of the quote's last event (B-08).
    const scored = score(ctx.scoring, (await loadScoringFacts(db, quoteId))!, at);
    await setQuotePriority(db, quoteId, scored, at, { tierOverridden: false });

    await addExtras(ctx, quoteId, kam, createdAt, at, ordinal);
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }
  return { quotes: plan.length, byStage };
}

/** Overrides, attachments metadata (no files), comments and a few view audits. */
async function addExtras(
  ctx: QuoteGenContext,
  quoteId: string,
  kam: Persona,
  from: Date,
  to: Date,
  ordinal: number,
) {
  const { db, rng, personas } = ctx;
  const mid = new Date(from.getTime() + (to.getTime() - from.getTime()) / 2 + 3_600_000);
  const leader = personas.get('sales-leader')!;

  if (ordinal % 9 === 0) {
    const status = rng.pick([
      'requested',
      'approved',
      'applied',
      'applied',
      'rejected',
      'reverted',
    ] as const);
    const decided = status !== 'requested';
    await insertOverride(db, {
      quoteId,
      field: 'priority_tier',
      originalValue: 'STANDARD',
      requestedValue: 'HIGH',
      justification: 'Strategic account renewal tied to this launch.',
      reasonCode: 'strategic_account',
      requestedBy: kam.id,
      status,
      decidedBy: decided ? leader.id : null,
      decidedAt: decided ? mid : null,
      decisionNote:
        status === 'rejected'
          ? 'Score already reflects the account; keep the computed tier.'
          : null,
      revertedBy: status === 'reverted' ? leader.id : null,
      revertedAt: status === 'reverted' ? new Date(mid.getTime() + DAY_MS) : null,
      createdAt: from,
      createdBy: kam.id,
    });
    if (status === 'applied' || status === 'approved') {
      await updateQuote(db, quoteId, { priorityTier: 'HIGH', priorityTierOverridden: true });
    }
  } else if (ordinal % 23 === 0) {
    await insertOverride(db, {
      quoteId,
      field: 'ship_to',
      originalValue: null,
      requestedValue: { city: 'Alternate DC (synthetic)' },
      justification: 'Customer is consolidating to a new distribution centre.',
      requestedBy: kam.id,
      status: 'applied',
      decidedBy: kam.id,
      decidedAt: mid,
      createdAt: from,
      createdBy: kam.id,
    });
  }

  const files = rng.int(0, 3);
  for (let k = 0; k < files; k++) {
    const kind = rng.pick(['bottle_drawing', 'spec', 'sample_photo', 'other'] as const);
    const ext =
      kind === 'sample_photo'
        ? 'jpg'
        : kind === 'bottle_drawing'
          ? 'pdf'
          : rng.pick(['pdf', 'xlsx']);
    await insertAttachment(db, {
      quoteId,
      kind,
      fileName: `${kind}-${k + 1}.${ext}`,
      size: rng.int(40, 9_000) * 1_024,
      mime:
        ext === 'jpg'
          ? 'image/jpeg'
          : ext === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      spDriveId: null,
      spItemId: null,
      spWebUrl: null,
      uploadedBy: kam.id,
      createdAt: from,
      createdBy: kam.id,
    });
  }

  if (rng.chance(0.35)) {
    const engLead = personas.get('eng-lead')!;
    await insertComment(db, {
      quoteId,
      authorId: engLead.id,
      body: 'Can we get a physical sample before we commit to the cavitation?',
      mentions: [kam.id],
      createdAt: mid,
      createdBy: engLead.id,
    });
    await insertComment(db, {
      quoteId,
      authorId: kam.id,
      body: 'Sample is on its way; ETA next week.',
      mentions: [],
      createdAt: new Date(mid.getTime() + 3_600_000),
      createdBy: kam.id,
    });
  }

  if (rng.chance(0.5)) {
    const viewer = rng.pick([...personas.values()]);
    await insertAuditEvent(db, {
      at: to,
      actorId: viewer.id,
      actorRoles: [...viewer.roles],
      action: 'view',
      entity: 'quote',
      entityId: quoteId,
      quoteId,
      requestId: 'synthetic-seed',
      createdAt: to,
    });
  }
}
