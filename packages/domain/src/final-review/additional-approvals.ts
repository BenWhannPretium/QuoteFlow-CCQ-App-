import { z } from 'zod';

import { FINAL_REVIEW_STAGE_KEY, RELEASE_GATE_KEY } from './release';
import { DomainError, type DomainErrorCode } from '../errors';
import type { Actor } from '../types/actor';
import { ROLES, type Role } from '../types/roles';

/**
 * FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs before the approver may release the
 * offer, e.g. "when the customer funds capital (customer-funded or $0 CER), the sales leader and then
 * leadership sign off" (Bailey's Nov 9 proposal; Gemma: leadership decides whether to take the
 * business, not Pricing). Not settled (Oleg, Nov 9), so this is a hook: `app_setting
 * g4_additional_approvals` holds the rules and the proposal is seeded with `active: false`. An Admin
 * switches it on without a release once A-035 confirms it. Nobody is named in code.
 *
 * Shape (the setting's value):
 * {
 *   "rules": [{
 *     "key": "customer_funded", "label": "…", "active": false,
 *     "when": { "fundingModels": ["CUSTOMER_FUNDED", "ZERO_CER"] },
 *     "signoffs": [                                    // in order: each waits for the one before
 *       { "key": "sales_leader", "label": "Sales leader", "roles": ["SalesLeader"] },
 *       { "key": "leadership", "label": "Leadership", "roles": ["Leadership"], "userIds": [] }
 *     ]
 *   }]
 * }
 * A sign-off belongs to the quote version it was given on (a rework asks again). The person signing
 * needs `finalReview.signoff` and one of the sign-off's roles (or to be one of its users).
 */
const signoffSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(120),
    roles: z.array(z.enum(ROLES)).default([]),
    userIds: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((s) => s.roles.length + s.userIds.length > 0, {
    message: 'a sign-off needs at least one role or user',
  });

const ruleSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(200),
    active: z.boolean(),
    when: z.object({ fundingModels: z.array(z.string().min(1)).min(1) }).strict(),
    signoffs: z.array(signoffSchema).min(1),
  })
  .strict()
  .refine((r) => new Set(r.signoffs.map((s) => s.key)).size === r.signoffs.length, {
    message: 'sign-off keys must be unique within a rule',
  });

export const additionalApprovalsSchema = z
  .object({ rules: z.array(ruleSchema) })
  .strict()
  .refine((s) => new Set(s.rules.map((r) => r.key)).size === s.rules.length, {
    message: 'rule keys must be unique',
  });

export type AdditionalApprovalRule = z.infer<typeof ruleSchema>;
export type AdditionalApprovalSignoff = z.infer<typeof signoffSchema>;
export type AdditionalApprovals = z.infer<typeof additionalApprovalsSchema>;

/** Seed: the Nov 9 proposal, switched off (provisional until A-035 and D-002). */
export const G4_ADDITIONAL_APPROVALS_SEED: AdditionalApprovals = {
  rules: [
    {
      key: 'customer_funded_capital',
      label: 'Customer-funded capital: sales leader, then leadership',
      active: false,
      when: { fundingModels: ['CUSTOMER_FUNDED', 'ZERO_CER'] },
      signoffs: [
        { key: 'sales_leader', label: 'Sales leader', roles: ['SalesLeader'], userIds: [] },
        { key: 'leadership', label: 'Leadership', roles: ['Leadership'], userIds: [] },
      ],
    },
  ],
};

/** `app_setting.g4_additional_approvals`. Unset = the seed (off); malformed = INVALID_CONFIG. */
export function parseAdditionalApprovals(input: unknown): AdditionalApprovals {
  if (input === undefined || input === null) return structuredClone(G4_ADDITIONAL_APPROVALS_SEED);
  const parsed = additionalApprovalsSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `g4_additional_approvals failed validation: ${detail}`);
  }
  return parsed.data;
}

/** A sign-off recorded on the quote (current version). */
export interface RecordedSignoff {
  ruleKey: string;
  signoffKey: string;
  signedBy: string;
  signedAt: Date;
}

export interface SignoffStatus {
  ruleKey: string;
  ruleLabel: string;
  signoffKey: string;
  signoffLabel: string;
  roles: Role[];
  signed: RecordedSignoff | null;
  /** The sign-offs before it are done. */
  ready: boolean;
}

/** The active rules that apply to the quote (its funding model). */
export function applicableRules(
  setting: AdditionalApprovals,
  fields: Readonly<Record<string, unknown>>,
): AdditionalApprovalRule[] {
  const funding = fields.tooling_funding_model;
  return setting.rules.filter(
    (r) => r.active && typeof funding === 'string' && r.when.fundingModels.includes(funding),
  );
}

/** Each sign-off the quote needs, in order, with what is recorded. */
export function signoffStatuses(
  setting: AdditionalApprovals,
  fields: Readonly<Record<string, unknown>>,
  recorded: readonly RecordedSignoff[],
): SignoffStatus[] {
  const out: SignoffStatus[] = [];
  for (const rule of applicableRules(setting, fields)) {
    let ready = true;
    for (const s of rule.signoffs) {
      const signed = recorded.find((r) => r.ruleKey === rule.key && r.signoffKey === s.key) ?? null;
      out.push({
        ruleKey: rule.key,
        ruleLabel: rule.label,
        signoffKey: s.key,
        signoffLabel: s.label,
        roles: s.roles,
        signed,
        ready,
      });
      if (!signed) ready = false;
    }
  }
  return out;
}

const mayFill = (actor: Actor, s: AdditionalApprovalSignoff) =>
  s.roles.some((r) => actor.roles.includes(r)) || s.userIds.includes(actor.userId);

/** Whether the actor may record this sign-off now (for the screen's button). */
export function canSign(
  setting: AdditionalApprovals,
  status: SignoffStatus,
  actor: Actor,
): boolean {
  const rule = setting.rules.find((r) => r.key === status.ruleKey);
  const s = rule?.signoffs.find((x) => x.key === status.signoffKey);
  return !!s && !status.signed && status.ready && mayFill(actor, s);
}

/** G4 Approve is refused while any applicable sign-off is missing. Pure. */
export function additionalApprovalErrors(
  setting: AdditionalApprovals,
  fields: Readonly<Record<string, unknown>>,
  recorded: readonly RecordedSignoff[],
  gateKey: string,
  outcomeKey: string,
): DomainError[] {
  if (gateKey !== RELEASE_GATE_KEY || outcomeKey !== 'approve') return [];
  const missing = signoffStatuses(setting, fields, recorded).filter((s) => !s.signed);
  return missing.length === 0
    ? []
    : [
        new DomainError(
          'ADDITIONAL_APPROVAL_REQUIRED',
          `Final Review also needs: ${missing.map((m) => m.signoffLabel).join(', then ')}`,
        ),
      ];
}

export type SignoffPlan =
  | {
      ok: true;
      rule: AdditionalApprovalRule;
      signoff: AdditionalApprovalSignoff;
      note: string | null;
    }
  | { ok: false; errors: DomainError[] };

/** Record a sign-off: the quote is in Final Review, the rule applies, the turn is theirs. */
export function planSignoff(input: {
  setting: AdditionalApprovals;
  fields: Readonly<Record<string, unknown>>;
  recorded: readonly RecordedSignoff[];
  stageKey: string;
  closed: boolean;
  actor: Actor;
  ruleKey: string;
  signoffKey: string;
  note: string | null | undefined;
}): SignoffPlan {
  const fail = (code: DomainErrorCode, message: string, field?: string) => ({
    ok: false as const,
    errors: [new DomainError(code, message, field)],
  });
  if (input.closed) return fail('QUOTE_CLOSED', 'The quote is closed');
  if (input.stageKey !== FINAL_REVIEW_STAGE_KEY) {
    return fail('WRONG_STAGE', 'Sign-offs are given while the quote is in Final Review');
  }
  const rule = applicableRules(input.setting, input.fields).find((r) => r.key === input.ruleKey);
  if (!rule) return fail('INVALID_VALUE', 'No such sign-off applies to this quote', 'ruleKey');
  const signoff = rule.signoffs.find((s) => s.key === input.signoffKey);
  if (!signoff) return fail('INVALID_VALUE', 'No such sign-off in this rule', 'signoffKey');
  if (!mayFill(input.actor, signoff)) {
    return fail('NOT_PERMITTED', `This sign-off is for: ${signoff.label}`);
  }
  const status = signoffStatuses(input.setting, input.fields, input.recorded).find(
    (s) => s.ruleKey === rule.key && s.signoffKey === signoff.key,
  )!;
  if (status.signed) return fail('ALREADY_SIGNED', `${signoff.label} has already signed off`);
  if (!status.ready) {
    return fail('OUT_OF_ORDER', 'The sign-off before this one is still missing');
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 1000)
    return fail('INVALID_VALUE', 'Keep it to 1000 characters', 'note');
  return { ok: true, rule, signoff, note };
}
