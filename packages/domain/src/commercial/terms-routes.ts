import { z } from 'zod';

import { DomainError } from '../errors';
import { rolesWithPermission } from '../policy/matrix';
import type { Permission } from '../types/permissions';

/**
 * FB-31 (N19-07; Sarah Brennan, Oleg Yarovinski, 2026-11-19): payment terms outside the standard ones
 * need an approval path with thresholds. Sarah: "there's no world where you submit a quote for net 60
 * without some sort of larger strategic view and a CFO approval and formal documentation around that."
 * Sarah and Oleg will first map where Pretium is financially exposed, then agree thresholds with Fede
 * Barreto and James. **The thresholds and approvers are not decided**: this is the routing mechanism, and
 * its seed is a guess from one sentence of the meeting, there so the mechanism can be shown, not policy.
 *
 * `app_setting.terms_exception_routes` (provisional) is an ordered list of tiers. A non-standard
 * payment-terms code goes to the first tier that lists it; a non-standard code no tier lists falls to the
 * first tier (what happened before FB-31: the pricing lead), so nothing is ever without an approver.
 * Each tier names the permission whose holders decide it (from an allow-list), the label the screens and
 * notices use for them ("the pricing lead", "Leadership"), and whether the decision needs a supporting
 * document on the quote (attachment kind `payment_terms_approval`) as well as the written rationale.
 */

/**
 * The permissions a tier may name. `terms.exception.decide.senior` stands in for the CFO Sarah named:
 * there is no CFO role (roles come from Entra groups; adding one is IT's work and Ben's call), so it is
 * granted to Leadership. Replacing it is a matrix and config change once the right role exists.
 */
export const TERMS_EXCEPTION_APPROVER_PERMISSIONS = [
  'terms.exception.decide',
  'terms.exception.decide.senior',
] as const satisfies readonly Permission[];
export type TermsExceptionApproverPermission =
  (typeof TERMS_EXCEPTION_APPROVER_PERMISSIONS)[number];

const tierSchema = z
  .object({
    codes: z
      .array(z.string().trim().min(1).max(40))
      .min(1, 'List at least one payment-terms code')
      .refine((l) => new Set(l).size === l.length, 'List each code once'),
    approverPermission: z.enum(TERMS_EXCEPTION_APPROVER_PERMISSIONS),
    /** Who decides, as the screens say it ("the pricing lead", "Leadership"). */
    approverLabel: z.string().trim().min(1).max(60),
    /** The decision needs a supporting document on the quote, not only the rationale. */
    documentRequired: z.boolean(),
  })
  .strict();

export const termsExceptionRoutesSchema = z
  .array(tierSchema)
  .min(1, 'List at least one tier')
  .refine(
    (tiers) => {
      const codes = tiers.flatMap((t) => t.codes);
      return new Set(codes).size === codes.length;
    },
    { message: 'A payment-terms code may be in one tier only' },
  );

export type TermsExceptionTier = z.infer<typeof tierSchema>;
export type TermsExceptionRoutes = TermsExceptionTier[];

/**
 * Seed, provisional, a guess: Net 45 to the pricing lead (what happens today); Net 60, Net 90, Net 120 and
 * Other to Leadership (the CFO stand-in) with a supporting document. Not set by Sarah and Oleg.
 */
export const TERMS_EXCEPTION_ROUTES_SEED: TermsExceptionRoutes = [
  {
    codes: ['NET_45'],
    approverPermission: 'terms.exception.decide',
    approverLabel: 'the pricing lead',
    documentRequired: false,
  },
  {
    codes: ['NET_60', 'NET_90', 'NET_120', 'OTHER'],
    approverPermission: 'terms.exception.decide.senior',
    approverLabel: 'Leadership',
    documentRequired: true,
  },
];

/** `app_setting.terms_exception_routes`. Unset = the seed; malformed = INVALID_CONFIG. */
export function parseTermsExceptionRoutes(input: unknown): TermsExceptionRoutes {
  if (input === undefined || input === null) return structuredClone(TERMS_EXCEPTION_ROUTES_SEED);
  const parsed = termsExceptionRoutesSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.length ? `tier ${i.path.join('.')}` : '(list)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `terms_exception_routes failed validation: ${detail}`);
  }
  return parsed.data;
}

/**
 * The codes a tier names that the payment-terms list does not have (the Admin console refuses them).
 * `paymentTermCodes` is every code of value list `requested_payment_terms`, inactive ones included.
 */
export function termsExceptionRouteErrors(
  routes: TermsExceptionRoutes,
  paymentTermCodes: readonly string[],
): DomainError[] {
  const unknown = [...new Set(routes.flatMap((t) => t.codes))].filter(
    (c) => !paymentTermCodes.includes(c),
  );
  return unknown.length === 0
    ? []
    : [
        new DomainError(
          'INVALID_CONFIG',
          `terms_exception_routes names payment terms that are not on the list: ${unknown.join(', ')}`,
        ),
      ];
}

/** The tier a non-standard code goes to: the first that lists it, otherwise the first tier. */
export function termsExceptionTier(
  routes: TermsExceptionRoutes,
  code: string | null | undefined,
): TermsExceptionTier {
  return (code ? routes.find((t) => t.codes.includes(code)) : undefined) ?? routes[0]!;
}

/** What an open request was routed to (recorded on it when it opens, FB-31). */
export interface TermsExceptionRouting {
  approverPermission: TermsExceptionApproverPermission;
  approverLabel: string;
  documentRequired: boolean;
}

const isApproverPermission = (p: unknown): p is TermsExceptionApproverPermission =>
  (TERMS_EXCEPTION_APPROVER_PERMISSIONS as readonly unknown[]).includes(p);

/**
 * The routing of a request. A request opened since FB-31 carries its permission and whether a document
 * is needed, so a later config change does not reroute it; the label is the current config's for that
 * permission. A request from before FB-31 (no permission recorded) goes to the original decider, the
 * pricing lead's permission, with no document, which is how it was opened.
 */
export function termsExceptionRouting(
  routes: TermsExceptionRoutes,
  request: { approverPermission: string | null; documentRequired: boolean | null },
): TermsExceptionRouting {
  const permission = isApproverPermission(request.approverPermission)
    ? request.approverPermission
    : 'terms.exception.decide';
  const tier = routes.find((t) => t.approverPermission === permission);
  return {
    approverPermission: permission,
    approverLabel: tier?.approverLabel ?? 'the approver',
    documentRequired: request.documentRequired === true,
  };
}

/**
 * FB-31: a user may not decide a payment-terms exception they requested, unless the tier's approver is
 * also one of the roles that enter payment terms (`terms.edit`). Today that exception is the pricing lead,
 * who enters terms and is the only Net 45 decider: a bar there would leave nobody able to decide (a
 * question for Ben). The bar applies where the approver differs from the requesters' roles: Leadership.
 */
export function requesterBarApplies(permission: TermsExceptionApproverPermission): boolean {
  const editors = new Set(rolesWithPermission('terms.edit'));
  return !rolesWithPermission(permission).some((r) => editors.has(r));
}

/** The intake chip and the Commercial tab: "Non-standard: needs approval by Leadership". */
export const nonStandardTermsText = (tier: Pick<TermsExceptionTier, 'approverLabel'>): string =>
  `Non-standard: needs approval by ${tier.approverLabel}`;

/** The line under it when the tier needs a supporting document. */
export const TERMS_DOCUMENT_REQUIRED_TEXT =
  'A written rationale and a supporting document (Payment-terms approval) are needed.';

/** "Waiting for Leadership" on the request. */
export const termsExceptionWaitingText = (routing: Pick<TermsExceptionRouting, 'approverLabel'>) =>
  `Waiting for ${routing.approverLabel}`;
