import { describe, expect, it } from 'vitest';

import {
  TERMS_DOCUMENT_MISSING_TEXT,
  TERMS_EXCEPTION_ROUTES_SEED,
  nonStandardTermsText,
  parseTermsExceptionRoutes,
  planTermsExceptionDecision,
  requesterBarApplies,
  termsExceptionRouteErrors,
  termsExceptionRouting,
  termsExceptionTier,
  termsExceptionWaitingText,
  type TermsExceptionRouting,
} from '.';
import { DomainError } from '../errors';
import { can } from '../policy/can';
import { makeActor, makeQuote } from '../test-utils';
import { ROLES } from '../types/roles';

const PAYMENT_CODES = ['NET_15', 'NET_30', 'NET_45', 'NET_60', 'NET_90', 'NET_120', 'OTHER'];

describe('terms_exception_routes (FB-31, N19-07)', () => {
  const routes = parseTermsExceptionRoutes(null);

  it('unset reads the provisional seed', () => {
    expect(routes).toEqual(TERMS_EXCEPTION_ROUTES_SEED);
    expect(termsExceptionRouteErrors(routes, PAYMENT_CODES)).toEqual([]);
  });

  it('sends each code to its tier, and an unlisted non-standard code to the first tier', () => {
    expect(termsExceptionTier(routes, 'NET_45')).toMatchObject({
      approverPermission: 'terms.exception.decide',
      documentRequired: false,
    });
    for (const code of ['NET_60', 'NET_90', 'NET_120', 'OTHER']) {
      expect(termsExceptionTier(routes, code)).toMatchObject({
        approverPermission: 'terms.exception.decide.senior',
        approverLabel: 'Leadership',
        documentRequired: true,
      });
    }
    // NET_75 is on no tier (an Admin added it to the list): the first tier, as before FB-31.
    expect(termsExceptionTier(routes, 'NET_75').approverPermission).toBe('terms.exception.decide');
    expect(termsExceptionTier(routes, null)).toBe(routes[0]);
  });

  it('refuses an invalid setting', () => {
    const tier = {
      codes: ['NET_45'],
      approverPermission: 'terms.exception.decide',
      approverLabel: 'the pricing lead',
      documentRequired: false,
    };
    for (const bad of [
      [],
      [{ ...tier, codes: [] }],
      [{ ...tier, approverPermission: 'config.manage' }],
      [{ ...tier, approverPermission: 'terms.exception.approve' }],
      [{ ...tier, approverLabel: ' ' }],
      [tier, { ...tier, approverPermission: 'terms.exception.decide.senior' }],
      [{ ...tier, extra: true }],
      { tiers: [tier] },
    ]) {
      expect(() => parseTermsExceptionRoutes(bad)).toThrow(DomainError);
    }
    expect(parseTermsExceptionRoutes([tier])).toEqual([tier]);
  });

  it('names codes that are not on the payment-terms list', () => {
    const errors = termsExceptionRouteErrors(
      [{ ...routes[0]!, codes: ['NET_45', 'NET_75'] }],
      PAYMENT_CODES,
    );
    expect(errors.map((e) => e.message)).toEqual([
      'terms_exception_routes names payment terms that are not on the list: NET_75',
    ]);
  });

  it('keeps the routing recorded on a request when the config changes', () => {
    const changed = parseTermsExceptionRoutes([
      { ...routes[1]!, codes: ['NET_45', 'NET_60'], approverLabel: 'the CFO' },
      { ...routes[0]!, codes: ['NET_90'] },
    ]);
    // Recorded at opening: senior, with a document. The current config's label for that permission.
    expect(
      termsExceptionRouting(changed, {
        approverPermission: 'terms.exception.decide.senior',
        documentRequired: true,
      }),
    ).toEqual({
      approverPermission: 'terms.exception.decide.senior',
      approverLabel: 'the CFO',
      documentRequired: true,
    });
    // A request from before FB-31: the pricing lead, no document.
    expect(
      termsExceptionRouting(routes, { approverPermission: null, documentRequired: null }),
    ).toEqual({
      approverPermission: 'terms.exception.decide',
      approverLabel: 'the pricing lead',
      documentRequired: false,
    });
  });

  it('says who decides, in the tier’s words', () => {
    expect(nonStandardTermsText(routes[1]!)).toBe('Non-standard: needs approval by Leadership');
    expect(nonStandardTermsText(routes[0]!)).toBe(
      'Non-standard: needs approval by the pricing lead',
    );
    expect(termsExceptionWaitingText(routes[1]!)).toBe('Waiting for Leadership');
  });
});

describe('who holds the two approver permissions (FB-31)', () => {
  it('terms.exception.decide: the pricing lead; .senior: Leadership; nobody else', () => {
    const quote = makeQuote('FINAL_REVIEW');
    for (const role of ROLES) {
      const actor = makeActor(role);
      expect(can(actor, 'terms.exception.decide', quote), role).toBe(role === 'PricingLead');
      expect(can(actor, 'terms.exception.decide.senior', quote), role).toBe(role === 'Leadership');
    }
  });

  it('the requester bar applies to the senior tier only (the pricing lead also enters terms)', () => {
    expect(requesterBarApplies('terms.exception.decide')).toBe(false);
    expect(requesterBarApplies('terms.exception.decide.senior')).toBe(true);
  });
});

describe('the decision by tier (FB-31)', () => {
  const senior: TermsExceptionRouting = {
    approverPermission: 'terms.exception.decide.senior',
    approverLabel: 'Leadership',
    documentRequired: true,
  };
  const decide = (over: Partial<Parameters<typeof planTermsExceptionDecision>[0]> = {}) =>
    planTermsExceptionDecision({
      status: 'pending',
      decision: 'approve',
      rationale: 'Strategic account; CFO memo attached',
      closed: false,
      routing: senior,
      holdsApprover: true,
      isRequester: false,
      documentOnFile: true,
      ...over,
    });

  it('the right permission with a document approves', () => {
    expect(decide()).toMatchObject({ ok: true, status: 'approved' });
  });

  it('the wrong permission is refused with whose decision it is', () => {
    const r = decide({ holdsApprover: false });
    expect(!r.ok && r.errors.map((e) => [e.code, e.message])).toEqual([
      ['NOT_PERMITTED', 'This payment-terms exception is decided by Leadership'],
    ]);
  });

  it('the requester may not decide a senior-tier request', () => {
    const r = decide({ isRequester: true });
    expect(!r.ok && r.errors[0]!.code).toBe('NOT_PERMITTED');
    // The pricing lead may still decide a Net 45 request they entered (question for Ben).
    expect(
      decide({
        isRequester: true,
        routing: {
          ...senior,
          approverPermission: 'terms.exception.decide',
          documentRequired: false,
        },
      }).ok,
    ).toBe(true);
  });

  it('approving needs the document where the tier says so; rejecting does not', () => {
    const r = decide({ documentOnFile: false });
    expect(!r.ok && r.errors.map((e) => [e.field, e.message])).toEqual([
      ['document', TERMS_DOCUMENT_MISSING_TEXT],
    ]);
    expect(decide({ documentOnFile: false, decision: 'reject' })).toMatchObject({
      ok: true,
      status: 'rejected',
    });
    expect(
      decide({ documentOnFile: false, routing: { ...senior, documentRequired: false } }).ok,
    ).toBe(true);
  });
});
