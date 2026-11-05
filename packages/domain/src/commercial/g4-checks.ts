import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * FB-01 (F-069, Nov 3 Sales & Marketing leadership demo): the Final Review approver could not release the
 * offer until the KAM or a sales leader had ticked "terms checked", and the Legal review acted as
 * required. Both are owned by other roles and neither was on the review screen. The tracker's acceptance:
 * "Approver can complete final review without fields owned by other roles; legal review is optional."
 *
 * Which of the two block G4 Advance is now config (`app_setting.g4_required_checks`), seeded `[]` and
 * provisional: who finalizes terms is open (tracker D-003, built in FB-08). A check that is not required
 * but not done is shown to the approver as a warning, and the G4 decision records that they saw it.
 */
export const G4_CHECKS = ['terms_checked', 'legal_review'] as const;
export type G4Check = (typeof G4_CHECKS)[number];

/** Seed: nothing blocks the approver (provisional, D-003). */
export const G4_REQUIRED_CHECKS_SEED: G4Check[] = [];

const schema = z.array(z.enum(G4_CHECKS));

/** `app_setting.g4_required_checks`. Unset falls back to the seed; anything malformed is invalid config. */
export function parseG4RequiredChecks(input: unknown): G4Check[] {
  if (input === undefined || input === null) return [...G4_REQUIRED_CHECKS_SEED];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      'INVALID_CONFIG',
      `g4_required_checks must be a list of: ${G4_CHECKS.join(', ')}`,
    );
  }
  return [...new Set(parsed.data)];
}

/** The decision fields the G4 Advance rules read (`hybrid.ts` OFFER_READY). */
export function g4CheckFields(checks: readonly G4Check[]): {
  g4_terms_check_required: boolean;
  g4_legal_review_check_required: boolean;
} {
  return {
    g4_terms_check_required: checks.includes('terms_checked'),
    g4_legal_review_check_required: checks.includes('legal_review'),
  };
}

export interface G4CheckWarning {
  code: 'TERMS_NOT_CHECKED' | 'LEGAL_REVIEW_NOT_RECORDED';
  severity: 'risk';
  message: string;
}

export interface G4CheckInput {
  checks: readonly G4Check[];
  termsCheckedAt: Date | string | null;
  legalReviewRequired: boolean;
  legalReviewedOn: string | null;
}

/**
 * The checks that are open but do not block (not in `g4_required_checks`): the approver sees them as
 * warnings, with a link to the quote's Commercial panel, and may still approve. A required check that is
 * open blocks G4 Advance through the workflow rules instead, so it is not repeated here.
 */
export function g4CheckWarnings(input: G4CheckInput): G4CheckWarning[] {
  const out: G4CheckWarning[] = [];
  if (!input.termsCheckedAt && !input.checks.includes('terms_checked')) {
    out.push({
      code: 'TERMS_NOT_CHECKED',
      severity: 'risk',
      message: 'The commercial terms have not been checked by Sales or Pricing',
    });
  }
  if (
    input.legalReviewRequired &&
    !input.legalReviewedOn &&
    !input.checks.includes('legal_review')
  ) {
    out.push({
      code: 'LEGAL_REVIEW_NOT_RECORDED',
      severity: 'risk',
      message: 'A Legal review is triggered but no review date is recorded',
    });
  }
  return out;
}
