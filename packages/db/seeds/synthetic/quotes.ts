import {
  LEGAL_REVIEW_TRIGGERS_SEED,
  PASS_THROUGH_SEED,
  asUserId,
  evaluateTransition,
  score,
  withDerivedFields,
} from '@ccq/domain';
import type { Actor, ScoringModel, TransitionRequest, WorkflowConfig } from '@ccq/domain';

import type { SyntheticOpportunity } from './opportunities';
import { ORIGINAL_PERSONAS, type Persona, type PersonaKey } from './personas';
import type { Rng } from './rng';
import { DAY_MS } from './rng';
import type { DbOrTx } from '../../src/client';
import {
  getQuoteById,
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
  ['AWARDED', 19],
  // B-26: awarded, waiting in Commit & Hand Off (CER pending). Placed right after AWARDED and walked
  // like its last three, so the shuffle and every random draw stay exactly as before.
  ['COMMIT_HANDOFF', 3],
  ['CLOSED_LOST', 18],
  ['DECLINED', 8],
  ['EXPIRED', 12],
  ['REDIRECTED', 10],
];

/** Stages whose quotes end the seed closed (terminal). */
const CLOSED_STAGES = new Set([
  'AWARDED',
  'CLOSED_LOST',
  'DECLINED',
  'EXPIRED',
  'REDIRECTED',
  'NOT_AUTHORIZED',
]);
/** B-26: awarded stages (they take the closed-won SF opportunities). */
const AWARD_STAGES = new Set(['AWARDED', 'COMMIT_HANDOFF']);
const AWARDED_TARGET = QUOTE_STAGE_TARGETS.find(([stage]) => stage === 'AWARDED')![1];

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
  | { kind: 'handoff'; evidence: string; complete: boolean };

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
// 2026-10-30: the pricing lead decides G3 (the pricer submits to them), as the EngLead decides G2.
const g3 = (outcome = 'submit', extra = {}) => d('G3', outcome, 'pricing-lead', extra);
const g4 = (outcome = 'approve', extra = {}) => d('G4', outcome, 'g4', extra);
const g5 = (outcome: string, extra = {}) => d('G5', outcome, 'kam', extra);
const g6 = (outcome: string, extra = {}) => d('G6', outcome, 'kam', extra);

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
      gate === 'G1' ? 'g1' : gate === 'G2' ? 'eng-lead' : gate === 'G3' ? 'pricing-lead' : 'kam',
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
          // B-11: a Return bumps the version, so Pricing records the approval again before G3.
          { kind: 'pricing' },
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
    case 'COMMIT_HANDOFF': {
      // B-26: Commit & Hand Off quotes are walked as the awards after the 19 closed ones.
      const n = stage === 'AWARDED' ? i : AWARDED_TARGET + i;
      // B-13: the acceptance evidence is the Awarded reason code (no random draw: same data set).
      const evidence = (['po', 'verbal', 'po', 'loi', 'contract'] as const)[n % 5]!;
      const closes = stage === 'AWARDED';
      return {
        steps: [
          ...toCustomer,
          ...(n % 5 === 0 ? [hold('G5')] : []),
          g5('awarded', { reason: evidence }),
          { kind: 'handoff', evidence, complete: closes },
          // B-26: G6 closes Won once the CER and the hand-off are recorded.
          ...(closes ? [g6('advance', { reason: evidence })] : []),
        ],
        complete: true,
      };
    }
    case 'CLOSED_LOST':
      // A G2 Stop closes as DECLINED since B-10, so every seeded loss is a customer decision.
      if (i < 4)
        return {
          steps: [...toCustomer, g5('lost', { reason: 'capacity' })],
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
      // G1 and G2 Stops close as DECLINED (B-08, B-10); the rest are Final Review declines.
      if (i >= 2 && i < 4)
        return {
          steps: [
            ...toEng,
            ...engWork,
            g2('stop', {
              reason: 'customer_withdrew',
              note: 'Customer withdrew during the engineering review.',
            }),
          ],
          complete: true,
        };
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
          // B-13: before the validity date an expiry needs a note ("silence is not a loss").
          g5('expired', {
            reason: rng.pick(['no_response', 'validity_lapsed']),
            note: 'No reply after three follow-ups; the customer has gone quiet.',
          }),
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
    case 'NOT_AUTHORIZED':
      // Demo seed only (not in QUOTE_STAGE_TARGETS): awarded, then G6 Stop because the CER failed.
      return {
        steps: [
          ...toCustomer,
          g5('awarded', { reason: 'po' }),
          { kind: 'handoff', evidence: 'po', complete: false },
          g6('stop', {
            reason: 'cer_not_approved',
            note: 'Capital committee did not approve the CER at the quoted payback.',
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
  /**
   * The quotes to generate, as (final stage, scenario variant). Defaults to QUOTE_STAGE_TARGETS
   * (variants 0..n-1 per stage). The demo seed passes its own short list.
   */
  cases?: QuoteCase[];
}

export interface QuoteCase {
  stage: string;
  /** Picks the scenario variant (see `scenario`). */
  i: number;
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
  // B-26: Commit & Hand Off quotes stay open, so they count here even when a closed-won opportunity
  // is left for them (there are only a few).
  const cases =
    ctx.cases ??
    QUOTE_STAGE_TARGETS.flatMap(([stage, n]) =>
      Array.from({ length: n }, (_, i) => ({ stage, i })),
    );
  const activeTotal = cases.filter(({ stage }) => !CLOSED_STAGES.has(stage)).length;
  const spare = open.slice(activeTotal);
  if (spare.length === 0) throw new Error('synthetic seed: no spare open SF opportunities');
  let reuseCursor = 0;
  const nextReused = () => spare[reuseCursor++ % spare.length]!;

  // Plan every quote (scenario + timeline) first, then create them in time order so quote numbers
  // are chronological.
  const plan = rng
    .shuffle(cases)
    .map(({ stage, i }) => {
      const opp =
        AWARD_STAGES.has(stage) && won.length > 0
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
      // B-09: a ship-to override is an `override` row (see addExtras); the draw keeps the stream stable.
      shipToOverridden: discard(rng.chance(0.1)),
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
          // B-10: queue_position is only set by an EngLead pin (a queue_position override); the draw
          // keeps the stream stable.
          discard(rng.int(1, 30));
          await updateQuote(db, quoteId, { assignedEngineerId: engineer.id, assignedAt: at });
          await upsertEngReview(db, {
            quoteId,
            acceptedAt: at,
            acceptedBy: engineer.id,
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
            acceptedBy: analyst.id,
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
            // B-26: the capacity owner's sign-off (G2 Advance needs it). No draw.
            capacitySignoffStatus: 'approved',
            capacitySignoffBy: persona('eng-lead').id,
            capacitySignoffAt: at,
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
          // Same draws in the same order as before B-11, so the rest of the data set is unchanged.
          // B-26: no BPR; the legacy ERF number stays (the BPR draw is kept for the stream).
          const pricingRefs = { erf: [String(rng.int(10_000, 99_999))] };
          if (rng.chance(0.3)) discard(rng.int(1_000, 9_999));
          const capitalReadiness = rng.pick([
            'not_required',
            'pending',
            'pre_approved',
            'pre_approved',
          ]);
          // B-11: one record per quote version (a re-quote prices again; the prior record stays).
          const { version } = (await getQuoteById(db, quoteId))!;
          await upsertPricingRecord(db, {
            quoteId,
            quoteVersion: version,
            priceApprovedBy: pricing.id,
            priceApprovedAt: at,
            pricingBasisNote: 'Resin index of the approval month, FOB plant (synthetic).',
            pricingRefs,
            approvedRangeNote: 'Approved within the pricing-app range (synthetic).',
            costingCompleted: true,
            costingAttestedBy: pricing.id,
            costingAttestedAt: at,
            capitalReadiness,
            capitalPendingJustification:
              capitalReadiness === 'pending' ? 'CER in review; board date set (synthetic).' : null,
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
          // The evidence is the Awarded decision's reason code (B-13); the draw is kept so the rows
          // generated after it stay the same.
          discard(rng.pick(['verbal', 'po', 'po', 'loi', 'contract']));
          const contact = rng.faker.person.fullName();
          // B-26: no BPR (the draw is kept). A closing award has its CER approved (or not required)
          // and the hand-off accepted; one still in Commit & Hand Off waits on its CER.
          if (rng.chance(0.5)) discard(rng.int(1_000, 9_999));
          const day = at.toISOString().slice(0, 10);
          await insertHandoffRecord(db, {
            quoteId,
            acceptanceEvidence: step.evidence,
            acceptanceDate: day,
            receivingRole: cer ? 'commercial_activation' : 'npi_post_award_pm',
            receivingContactName: contact,
            acceptedOn: step.complete ? day : null,
            cerId: cer,
            cerStatus: step.complete ? (cer ? 'approved' : 'not_required') : 'pending',
            cerApprovedOn: step.complete && cer ? day : null,
            notes: 'Synthetic hand-off.',
            completedAt: step.complete ? at : null,
            completedBy: step.complete ? kam.id : null,
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
          // B-26: G4 Advance needs the terms check (and the Legal review for a new customer). No draws.
          if (step.gate === 'G4' && step.outcome === 'approve') {
            const newCustomer = opp.customer.status === 'not_yet_established';
            await updateQuote(db, quoteId, {
              termsToolingCommitment: false,
              termsPaymentTerms: 'Net 45',
              termsCheckedAt: at,
              termsCheckedBy: kam.id,
              ...(newCustomer
                ? {
                    legalReviewedOn: at.toISOString().slice(0, 10),
                    legalReviewerName: 'Legal (synthetic)',
                    legalRecordedBy: kam.id,
                  }
                : {}),
            });
            state!.fields = withDerivedFields(
              (await loadQuoteState(db, quoteId))!,
              SEED_DERIVED_SETTINGS,
            ).fields;
          }
          const payload =
            step.payload ??
            (step.hold
              ? {
                  review_date: new Date(at.getTime() + 21 * DAY_MS).toISOString().slice(0, 10),
                  hold_owner_id: decider.id,
                }
              : step.gate === 'G5' && step.outcome === 'awarded'
                ? { accepted_at: at.toISOString().slice(0, 10) }
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

/** B-26: the derived decision fields as the seeded settings define them. */
const SEED_DERIVED_SETTINGS = {
  legalReviewTriggers: LEGAL_REVIEW_TRIGGERS_SEED,
  passThrough: PASS_THROUGH_SEED,
};

/** Consume a random draw without using it, so the rows generated after it stay the same. */
const discard = (_draw: unknown): false => false;

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
    const drawn = rng.pick([
      'requested',
      'approved',
      'applied',
      'applied',
      'rejected',
      'reverted',
    ] as const);
    // B-09: approving applies at once, so a decided-for request is `applied`.
    const status = drawn === 'approved' ? 'applied' : drawn;
    const decided = status !== 'requested';
    const current = await getQuoteById(db, quoteId);
    const originalTier = current?.priorityTier ?? 'STANDARD';
    const requestedTier = originalTier === 'HIGH' ? 'CRITICAL' : 'HIGH';
    const o = await insertOverride(db, {
      quoteId,
      field: 'priority_tier',
      originalValue: originalTier,
      requestedValue: requestedTier,
      justification: 'Strategic account renewal tied to this launch.',
      reasonCode: 'strategic_account',
      requestedBy: kam.id,
      status,
      approvalMode: 'approver',
      decidedBy: decided ? leader.id : null,
      decidedAt: decided ? mid : null,
      appliedAt: status === 'applied' || status === 'reverted' ? mid : null,
      decisionNote:
        status === 'rejected'
          ? 'Score already reflects the account; keep the computed tier.'
          : null,
      revertedBy: status === 'reverted' ? leader.id : null,
      revertedAt: status === 'reverted' ? new Date(mid.getTime() + DAY_MS) : null,
      createdAt: from,
      createdBy: kam.id,
    });
    if (status === 'applied') {
      await updateQuote(db, quoteId, { priorityTier: requestedTier, priorityTierOverridden: true });
    }
    // The timeline events B-09's override service would have written.
    const payload = {
      overrideId: o.id,
      field: 'priority_tier',
      fieldLabel: 'Priority tier',
      from: originalTier,
      to: requestedTier,
      justification: o.justification,
      approvalMode: 'approver',
    };
    const events: { type: string; actorId: string; at: Date; payload: object }[] = [
      { type: 'override_requested', actorId: kam.id, at: from, payload },
    ];
    if (decided) {
      events.push({
        type: status === 'rejected' ? 'override_rejected' : 'override_applied',
        actorId: leader.id,
        at: mid,
        payload: { ...payload, note: o.decisionNote },
      });
    }
    if (status === 'reverted') {
      events.push({
        type: 'override_reverted',
        actorId: leader.id,
        at: new Date(mid.getTime() + DAY_MS),
        payload: { ...payload, from: requestedTier, to: originalTier },
      });
    }
    await db
      .insert(activityEvent)
      .values(events.map((e) => ({ quoteId, ...e, createdBy: e.actorId })));
  } else if (ordinal % 23 === 0) {
    const current = await getQuoteById(db, quoteId);
    const original = (current?.shipTo ?? null) as Record<string, unknown> | null;
    const requested = { ...(original ?? {}), line1: 'Alternate DC (synthetic)' };
    const justification = 'Customer is consolidating to a new distribution centre.';
    const o = await insertOverride(db, {
      quoteId,
      field: 'ship_to',
      originalValue: original,
      requestedValue: requested,
      justification,
      requestedBy: kam.id,
      status: 'applied',
      approvalMode: 'self',
      decidedBy: kam.id,
      decidedAt: mid,
      appliedAt: mid,
      createdAt: from,
      createdBy: kam.id,
    });
    await db.insert(activityEvent).values({
      quoteId,
      type: 'override_applied',
      actorId: kam.id,
      at: mid,
      payload: {
        overrideId: o.id,
        field: 'ship_to',
        fieldLabel: 'Ship-to',
        from: original,
        to: requested,
        justification,
        approvalMode: 'self',
      },
      createdBy: kam.id,
    });
    await updateQuote(db, quoteId, {
      shipTo: requested,
      shipToOriginal: original,
      shipToOverridden: true,
      shipToOverrideReason: justification,
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
    // The original personas only, so a later persona does not shift who viewed what.
    const viewer = rng.pick([...personas.values()].slice(0, ORIGINAL_PERSONAS));
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
