import { ROI_REQUIRED_WHEN_SEED } from '../quoting-steps';
import { describe, expect, it } from 'vitest';

import { withDerivedFields } from './derived';
import {
  G4_REQUIRED_CHECKS_SEED,
  g4CheckFields,
  g4CheckWarnings,
  parseG4RequiredChecks,
  type G4Check,
} from './g4-checks';
import { LEGAL_REVIEW_TRIGGERS_SEED } from './terms';
import { finalReviewAvailability } from '../final-review/availability';
import { NOW, makeActor, makeQuote } from '../test-utils';
import { evaluateTransition } from '../workflow/evaluate';
import { hybridConfig } from '../workflow/seeds/hybrid';

/**
 * FB-01 (F-069): "Approver can complete final review without fields owned by other roles; legal review
 * is optional." `g4_required_checks` decides which checks block G4 Advance; seeded `[]`.
 */
const settings = (checks: G4Check[]) => ({
  legalReviewTriggers: LEGAL_REVIEW_TRIGGERS_SEED,
  passThrough: { maxAnnualRevenueUsd: null },
  g4RequiredChecks: checks,
  roiRequiredWhen: ROI_REQUIRED_WHEN_SEED,
});

const approve = (checks: G4Check[], fields: Record<string, unknown>) =>
  evaluateTransition(
    hybridConfig,
    withDerivedFields(makeQuote('FINAL_REVIEW', { fields }), settings(checks)),
    makeActor('Approver'),
    { gateKey: 'G4', outcomeKey: 'approve' },
    NOW,
  );

const NEW_CUSTOMER = { customer_status: 'not_yet_established' };

describe('parseG4RequiredChecks', () => {
  it('seeds [] (provisional, D-003): nothing blocks the approver', () => {
    expect(G4_REQUIRED_CHECKS_SEED).toEqual([]);
    expect(parseG4RequiredChecks(undefined)).toEqual([]);
    expect(parseG4RequiredChecks(null)).toEqual([]);
  });

  it('accepts the two checks, once each', () => {
    expect(parseG4RequiredChecks(['terms_checked', 'legal_review', 'terms_checked'])).toEqual([
      'terms_checked',
      'legal_review',
    ]);
  });

  it('refuses anything else (invalid config, not a silent default)', () => {
    for (const bad of [['terms'], 'terms_checked', {}, [1]]) {
      expect(() => parseG4RequiredChecks(bad)).toThrow(/g4_required_checks/);
    }
  });
});

describe('G4 Advance with the setting off and on', () => {
  it('[]: the approver approves with unchecked terms and a triggered, unrecorded Legal review', () => {
    expect(approve([], {}).ok).toBe(true);
    expect(approve([], NEW_CUSTOMER).ok).toBe(true);
  });

  it("['terms_checked']: unchecked terms block; Legal stays optional", () => {
    const r = approve(['terms_checked'], {});
    expect(!r.ok && r.errors.map((e) => [e.code, e.field])).toEqual([
      ['MISSING_FIELD', 'g4_terms_check_required,terms_checked_at'],
    ]);
    expect(approve(['terms_checked'], { terms_checked_at: NOW, ...NEW_CUSTOMER }).ok).toBe(true);
  });

  it("['legal_review']: a triggered Legal review blocks until recorded; an untriggered one never does", () => {
    expect(approve(['legal_review'], { customer_status: 'existing' }).ok).toBe(true);
    expect(approve(['legal_review'], NEW_CUSTOMER).ok).toBe(false);
    expect(approve(['legal_review'], { ...NEW_CUSTOMER, legal_reviewed_on: '2026-11-04' }).ok).toBe(
      true,
    );
  });

  it('a quote state without the derived fields fails closed (both checks apply)', () => {
    const r = evaluateTransition(
      hybridConfig,
      makeQuote('FINAL_REVIEW'),
      makeActor('Approver'),
      { gateKey: 'G4', outcomeKey: 'approve' },
      NOW,
    );
    expect(r.ok).toBe(false);
  });

  it('g4CheckFields', () => {
    expect(g4CheckFields([])).toEqual({
      g4_terms_check_required: false,
      g4_legal_review_check_required: false,
    });
    expect(g4CheckFields(['terms_checked', 'legal_review'])).toEqual({
      g4_terms_check_required: true,
      g4_legal_review_check_required: true,
    });
  });
});

describe('availability: the decision bar does not depend on fields other roles own', () => {
  it.each([[[]], [['terms_checked']], [['terms_checked', 'legal_review']]] as G4Check[][][])(
    'with %j the approver can decide G4 (the field rules are checked in the dialog)',
    (checks) => {
      const quote = withDerivedFields(
        makeQuote('FINAL_REVIEW', { fields: NEW_CUSTOMER }),
        settings(checks),
      );
      expect(finalReviewAvailability(hybridConfig, quote, makeActor('Approver'))).toEqual({
        canDecide: true,
        blockedBy: [],
      });
    },
  );
});

describe('g4CheckWarnings: open checks that do not block', () => {
  const base = {
    termsCheckedAt: null,
    legalReviewRequired: true,
    legalReviewedOn: null,
  };

  it('[]: both open checks are warnings', () => {
    expect(g4CheckWarnings({ ...base, checks: [] }).map((w) => w.code)).toEqual([
      'TERMS_NOT_CHECKED',
      'LEGAL_REVIEW_NOT_RECORDED',
    ]);
  });

  it('a required check is a blocker, not a warning', () => {
    expect(g4CheckWarnings({ ...base, checks: ['terms_checked'] }).map((w) => w.code)).toEqual([
      'LEGAL_REVIEW_NOT_RECORDED',
    ]);
    expect(g4CheckWarnings({ ...base, checks: ['terms_checked', 'legal_review'] })).toEqual([]);
  });

  it('done checks, and an untriggered Legal review, raise nothing', () => {
    expect(
      g4CheckWarnings({
        checks: [],
        termsCheckedAt: NOW,
        legalReviewRequired: true,
        legalReviewedOn: '2026-11-04',
      }),
    ).toEqual([]);
    expect(
      g4CheckWarnings({ ...base, checks: [], termsCheckedAt: NOW, legalReviewRequired: false }),
    ).toEqual([]);
  });
});
