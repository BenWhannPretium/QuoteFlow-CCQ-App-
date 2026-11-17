import {
  NEXT_STEP_PARTY_VALUES,
  NEXT_STEP_PLACE_VALUES,
  NEXT_STEP_STATE_VALUES,
  QuoteNextStep,
} from '@ccq/contracts';
import {
  NEXT_STEP_PARTIES,
  NEXT_STEP_PLACES,
  NEXT_STEP_STATES,
  asUserId,
  hybridConfig,
  type Actor,
} from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { quoteNextStep, type NextStepSource } from './quote-next-step';

const READER = asUserId('0192f0c0-0000-7000-8000-000000000001');
const actor = (roles: Actor['roles']): Actor => ({
  userId: READER,
  roles,
  scope: { type: 'all' },
});

const leadReview = { status: 'none', submittedAt: null, canSendBack: false };
/** Only the parts the next step reads; the rest of the detail does not matter here. */
function source(over: Record<string, unknown> = {}): NextStepSource {
  return {
    stageKey: 'QUOTING',
    status: 'active',
    kamUserId: 'user-kam',
    kamName: 'Dana Whitfield',
    reviewDate: null,
    rework: null,
    availableActions: [],
    engineering: {
      assignedEngineerId: null,
      assignedEngineerName: null,
      canAssign: false,
      canEdit: false,
      leadReview,
    },
    quoting: {
      inQuoting: true,
      assignedPricerId: 'user-pricer',
      assignedPricerName: 'Kyle Arnold',
      canAssign: false,
      canEdit: false,
      leadReview,
      steps: { current: 'costing', roi: { canUpload: false } },
    },
    commercial: { hold: { ownerId: null, ownerName: null, reasonLabel: null } },
    ...over,
  } as unknown as NextStepSource;
}

describe('quoteNextStep', () => {
  it('the contract lists the same parties, states and places as the domain', () => {
    expect([...NEXT_STEP_PARTY_VALUES]).toEqual([...NEXT_STEP_PARTIES]);
    expect([...NEXT_STEP_STATE_VALUES]).toEqual([...NEXT_STEP_STATES]);
    expect([...NEXT_STEP_PLACE_VALUES]).toEqual([...NEXT_STEP_PLACES]);
  });

  it('returns what the contract accepts', () => {
    const step = quoteNextStep(hybridConfig, actor(['Pricing']), source());
    expect(QuoteNextStep.parse(step)).toEqual(step);
    expect(step).toMatchObject({
      waitingOn: 'pricing',
      personName: 'Kyle Arnold',
      state: 'in_progress',
    });
  });

  it('a lead-review round counts only while it is submitted', () => {
    const quoting = (review: object) => ({
      ...source().quoting,
      leadReview: { ...leadReview, ...review },
    });
    const returned = source({
      quoting: quoting({ status: 'returned', submittedAt: '2026-11-10T15:00:00.000Z' }),
    });
    expect(quoteNextStep(hybridConfig, actor(['PricingLead']), returned).state).toBe('in_progress');
    const submitted = source({
      quoting: quoting({
        status: 'submitted',
        submittedAt: '2026-11-10T15:00:00.000Z',
        canSendBack: true,
      }),
    });
    expect(quoteNextStep(hybridConfig, actor(['PricingLead']), submitted)).toMatchObject({
      state: 'with_lead',
      since: '2026-11-10T15:00:00.000Z',
      yourMove: true,
    });
  });

  it('the payback step is Finance’s move, not its fallback uploaders’', () => {
    const waiting = source({
      quoting: { ...source().quoting, steps: { current: 'roi', roi: { canUpload: true } } },
    });
    expect(quoteNextStep(hybridConfig, actor(['Finance']), waiting)).toMatchObject({
      waitingOn: 'finance',
      yourMove: true,
    });
    expect(quoteNextStep(hybridConfig, actor(['PricingLead']), waiting)).toMatchObject({
      waitingOn: 'finance',
      yourMove: false,
    });
  });

  it('a gate is the caller’s to decide only when an offered outcome has nothing missing', () => {
    const at = (missing: { field: string; message: string }[]) =>
      source({
        stageKey: 'INTAKE',
        availableActions: [{ gateKey: 'G1', outcomeKey: 'advance', missing }],
      });
    expect(quoteNextStep(hybridConfig, actor(['SalesLeader']), at([])).yourMove).toBe(true);
    expect(
      quoteNextStep(
        hybridConfig,
        actor(['SalesLeader']),
        at([{ field: 'submitted_at', message: 'The intake, submitted by the KAM' }]),
      ).yourMove,
    ).toBe(false);
  });

  it('the hold is read only while the quote is on hold', () => {
    const commercial = {
      hold: { ownerId: 'u', ownerName: 'Avery Stone', reasonLabel: 'Awaiting internal input' },
    };
    expect(quoteNextStep(hybridConfig, actor(['KAM']), source({ commercial })).hold).toBeNull();
    expect(
      quoteNextStep(
        hybridConfig,
        actor(['KAM']),
        source({ commercial, status: 'on_hold', reviewDate: '2026-12-01' }),
      ),
    ).toMatchObject({
      state: 'on_hold',
      hold: {
        reviewDate: '2026-12-01',
        ownerName: 'Avery Stone',
        reasonLabel: 'Awaiting internal input',
      },
    });
  });
});
