import { describe, expect, it } from 'vitest';

import {
  G4_ADDITIONAL_APPROVALS_SEED,
  additionalApprovalErrors,
  canSign,
  parseAdditionalApprovals,
  planSignoff,
  signoffStatuses,
  type AdditionalApprovals,
  type RecordedSignoff,
} from './additional-approvals';
import { DomainError } from '../errors';
import { NOW, makeActor } from '../test-utils';

/** FB-08 (F-082, D-002, A-035 open): the extra Final Review sign-offs, seeded off. */
const on: AdditionalApprovals = {
  rules: G4_ADDITIONAL_APPROVALS_SEED.rules.map((r) => ({ ...r, active: true })),
};
const customerFunded = { tooling_funding_model: 'CUSTOMER_FUNDED' };
const signed = (signoffKey: string): RecordedSignoff => ({
  ruleKey: 'customer_funded_capital',
  signoffKey,
  signedBy: 'someone',
  signedAt: NOW,
});

describe('g4_additional_approvals (F-082)', () => {
  it('seeds the Nov 9 proposal switched off: nothing is required', () => {
    expect(G4_ADDITIONAL_APPROVALS_SEED.rules.every((r) => !r.active)).toBe(true);
    expect(parseAdditionalApprovals(null)).toEqual(G4_ADDITIONAL_APPROVALS_SEED);
    expect(signoffStatuses(parseAdditionalApprovals(null), customerFunded, [])).toEqual([]);
    expect(
      additionalApprovalErrors(G4_ADDITIONAL_APPROVALS_SEED, customerFunded, [], 'G4', 'approve'),
    ).toEqual([]);
  });

  it('refuses malformed config', () => {
    expect(() => parseAdditionalApprovals({ rules: [{ key: 'x' }] })).toThrow(DomainError);
    const dupe = { rules: [on.rules[0], on.rules[0]] };
    expect(() => parseAdditionalApprovals(dupe)).toThrow(/unique/);
    const nobody = {
      rules: [{ ...on.rules[0], signoffs: [{ key: 'a', label: 'A', roles: [], userIds: [] }] }],
    };
    expect(() => parseAdditionalApprovals(nobody)).toThrow(/role or user/);
  });

  it('when on, a customer-funded or $0 CER quote needs the sales leader, then leadership', () => {
    expect(signoffStatuses(on, { tooling_funding_model: 'COMPANY_FUNDED' }, [])).toEqual([]);
    const statuses = signoffStatuses(on, { tooling_funding_model: 'ZERO_CER' }, []);
    expect(statuses.map((s) => [s.signoffKey, s.ready])).toEqual([
      ['sales_leader', true],
      ['leadership', false],
    ]);
    const errors = additionalApprovalErrors(on, customerFunded, [], 'G4', 'approve');
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ['ADDITIONAL_APPROVAL_REQUIRED', 'Final Review also needs: Sales leader, then Leadership'],
    ]);
    expect(additionalApprovalErrors(on, customerFunded, [], 'G4', 'hold')).toEqual([]);
    expect(
      additionalApprovalErrors(
        on,
        customerFunded,
        [signed('sales_leader'), signed('leadership')],
        'G4',
        'approve',
      ),
    ).toEqual([]);
  });

  it('a sign-off is given in order, by its role, in Final Review, once', () => {
    const base = {
      setting: on,
      fields: customerFunded,
      recorded: [] as RecordedSignoff[],
      stageKey: 'FINAL_REVIEW',
      closed: false,
      actor: makeActor('SalesLeader'),
      ruleKey: 'customer_funded_capital',
      signoffKey: 'sales_leader',
      note: ' ok ',
    };
    expect(planSignoff(base)).toMatchObject({ ok: true, note: 'ok' });
    const code = (over: Partial<typeof base>) => {
      const r = planSignoff({ ...base, ...over });
      return r.ok ? 'ok' : r.errors[0]!.code;
    };
    expect(code({ actor: makeActor('Leadership') })).toBe('NOT_PERMITTED');
    expect(code({ actor: makeActor('Leadership'), signoffKey: 'leadership' })).toBe('OUT_OF_ORDER');
    expect(
      code({
        actor: makeActor('Leadership'),
        signoffKey: 'leadership',
        recorded: [signed('sales_leader')],
      }),
    ).toBe('ok');
    expect(code({ recorded: [signed('sales_leader')] })).toBe('ALREADY_SIGNED');
    expect(code({ stageKey: 'QUOTING' })).toBe('WRONG_STAGE');
    expect(code({ fields: { tooling_funding_model: 'COMPANY_FUNDED' } })).toBe('INVALID_VALUE');
    expect(code({ closed: true })).toBe('QUOTE_CLOSED');
  });

  it('canSign guides the screen', () => {
    const [first, second] = signoffStatuses(on, customerFunded, []);
    expect(canSign(on, first!, makeActor('SalesLeader'))).toBe(true);
    expect(canSign(on, second!, makeActor('Leadership'))).toBe(false);
  });
});
