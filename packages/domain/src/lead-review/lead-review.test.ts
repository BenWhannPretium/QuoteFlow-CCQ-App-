import { describe, expect, it } from 'vitest';

import { canEditEngReview } from '../engineering/review';
import { canEditQuoting } from '../pricing/record';
import { NOW, makeActor, makeQuote, validCase } from '../test-utils';
import {
  EMPTY_LEAD_REVIEW,
  canReturnToAssignee,
  canSubmitToLead,
  leadReviewStatus,
  lockedFor,
  planReturnToAssignee,
  planSubmitToLead,
  submissionRules,
  type LeadReviewState,
} from './index';
import { asUserId } from '../types/ids';
import { hybridConfig } from '../workflow/seeds/hybrid';

const ENGINEER = asUserId('user-engineer');
const PRICER = asUserId('user-pricer');
const engineer = makeActor('Engineer', { userId: ENGINEER });
const otherEngineer = makeActor('Engineer');
const engLead = makeActor('EngLead');
const pricer = makeActor('Pricing', { userId: PRICER });
const otherPricer = makeActor('Pricing');
const pricingLead = makeActor('PricingLead');

const engQuote = (overrides = {}) =>
  makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER, ...overrides });
const pricingQuote = (overrides = {}) =>
  makeQuote('QUOTING', { assignedPricerId: PRICER, ...overrides });
const submitted: LeadReviewState = {
  ...EMPTY_LEAD_REVIEW,
  submittedAt: NOW,
  submittedBy: ENGINEER,
};

describe('who may submit to the lead', () => {
  it('only the assignee, in the stage, not a lead, once', () => {
    expect(canSubmitToLead('engineering', engineer, engQuote(), EMPTY_LEAD_REVIEW)).toBe(true);
    expect(canSubmitToLead('engineering', otherEngineer, engQuote(), EMPTY_LEAD_REVIEW)).toBe(
      false,
    );
    expect(canSubmitToLead('engineering', engineer, engQuote(), submitted)).toBe(false);
    expect(canSubmitToLead('engineering', engineer, makeQuote('QUOTING'), EMPTY_LEAD_REVIEW)).toBe(
      false,
    );
    expect(canSubmitToLead('pricing', pricer, pricingQuote(), EMPTY_LEAD_REVIEW)).toBe(true);
    expect(canSubmitToLead('pricing', otherPricer, pricingQuote(), EMPTY_LEAD_REVIEW)).toBe(false);
  });

  it('a lead assigned to themselves has nobody to submit to', () => {
    const lead = makeActor('EngLead', { userId: ENGINEER });
    expect(canSubmitToLead('engineering', lead, engQuote(), EMPTY_LEAD_REVIEW)).toBe(false);
    const pLead = makeActor('PricingLead', { userId: PRICER });
    expect(canSubmitToLead('pricing', pLead, pricingQuote(), EMPTY_LEAD_REVIEW)).toBe(false);
  });
});

describe('the submission is checked against the gate, less the lead’s own steps', () => {
  it('engineering: G2 Advance fields, without the capacity sign-off', () => {
    const rules = submissionRules('engineering', hybridConfig);
    expect(JSON.stringify(rules)).not.toContain('capacity_signoff_status');
    const g2 = validCase(hybridConfig, 'G2', 'proceed');
    expect(JSON.stringify(g2.fields)).toContain('capacity_signoff_status');

    const empty = planSubmitToLead(
      'engineering',
      engineer,
      engQuote(),
      EMPTY_LEAD_REVIEW,
      hybridConfig,
      {},
    );
    expect(!empty.ok && empty.errors.every((e) => e.code === 'MISSING_FIELD')).toBe(true);

    // Everything G2 Advance needs except the lead's sign-off is enough.
    const { capacity_signoff_status: _signoff, ...fields } = g2.fields;
    expect(
      planSubmitToLead('engineering', engineer, engQuote(), EMPTY_LEAD_REVIEW, hybridConfig, fields)
        .ok,
    ).toBe(true);
  });

  it('pricing: G3 Advance fields', () => {
    const g3 = validCase(hybridConfig, 'G3', 'submit');
    expect(
      planSubmitToLead('pricing', pricer, pricingQuote(), EMPTY_LEAD_REVIEW, hybridConfig, {}).ok,
    ).toBe(false);
    expect(
      planSubmitToLead(
        'pricing',
        pricer,
        pricingQuote(),
        EMPTY_LEAD_REVIEW,
        hybridConfig,
        g3.fields,
      ).ok,
    ).toBe(true);
  });

  it('says why when it cannot submit', () => {
    const code = (plan: ReturnType<typeof planSubmitToLead>) => !plan.ok && plan.errors[0]!.code;
    expect(
      code(planSubmitToLead('engineering', engineer, engQuote(), submitted, hybridConfig, {})),
    ).toBe('ALREADY_SUBMITTED');
    expect(
      code(
        planSubmitToLead(
          'engineering',
          otherEngineer,
          engQuote(),
          EMPTY_LEAD_REVIEW,
          hybridConfig,
          {},
        ),
      ),
    ).toBe('NOT_PERMITTED');
    expect(
      code(
        planSubmitToLead(
          'engineering',
          engineer,
          engQuote({ status: 'closed' }),
          EMPTY_LEAD_REVIEW,
          hybridConfig,
          {},
        ),
      ),
    ).toBe('QUOTE_CLOSED');
  });
});

describe('sending back', () => {
  it('a lead, while submitted, with a note', () => {
    expect(canReturnToAssignee('engineering', engLead, engQuote(), submitted)).toBe(true);
    expect(canReturnToAssignee('engineering', engineer, engQuote(), submitted)).toBe(false);
    expect(canReturnToAssignee('engineering', engLead, engQuote(), EMPTY_LEAD_REVIEW)).toBe(false);
    expect(canReturnToAssignee('pricing', pricingLead, pricingQuote(), submitted)).toBe(true);

    const code = (plan: ReturnType<typeof planReturnToAssignee>) =>
      !plan.ok && plan.errors[0]!.code;
    expect(code(planReturnToAssignee('engineering', engLead, engQuote(), submitted, ' '))).toBe(
      'NOTE_REQUIRED',
    );
    expect(
      code(planReturnToAssignee('engineering', engLead, engQuote(), EMPTY_LEAD_REVIEW, 'x')),
    ).toBe('NOT_SUBMITTED');
    expect(code(planReturnToAssignee('engineering', engineer, engQuote(), submitted, 'x'))).toBe(
      'NOT_PERMITTED',
    );
    expect(
      planReturnToAssignee('engineering', engLead, engQuote(), submitted, 'Check the cavitation')
        .ok,
    ).toBe(true);
  });

  it('status: submitted, then returned, then none on a new stay', () => {
    expect(leadReviewStatus(submitted)).toBe('submitted');
    expect(
      leadReviewStatus({
        ...EMPTY_LEAD_REVIEW,
        returnedAt: NOW,
        returnedBy: 'lead',
        returnNote: 'x',
      }),
    ).toBe('returned');
    expect(leadReviewStatus(EMPTY_LEAD_REVIEW)).toBe('none');
  });
});

describe('locked on submit: only the lead edits', () => {
  it('engineering', () => {
    const open = engQuote();
    const sent = engQuote({ engSubmittedAt: NOW });
    expect(canEditEngReview(engineer, open)).toBe(true);
    expect(canEditEngReview(engineer, sent)).toBe(false);
    expect(lockedFor('engineering', engineer, sent)).toBe(true);
    expect(canEditEngReview(engLead, sent)).toBe(true);
  });

  it('pricing: the pricer, and any other pricer, until it is sent back', () => {
    const sent = pricingQuote({ pricingSubmittedAt: NOW });
    expect(canEditQuoting(pricer, pricingQuote())).toBe(true);
    expect(canEditQuoting(pricer, sent)).toBe(false);
    expect(canEditQuoting(otherPricer, sent)).toBe(false);
    expect(canEditQuoting(pricingLead, sent)).toBe(true);
  });
});
