import { describe, expect, it } from 'vitest';

import {
  EMPTY_PAYBACK_REQUEST,
  PAYBACK_NOTE_MAX,
  paybackFromFields,
  paybackHintText,
  paybackNeeded,
  paybackRequestStatus,
  planPaybackRequest,
  planPaybackWithdraw,
  type PaybackRequest,
} from './payback-request';
import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote } from '../test-utils';

/** FB-21 Part B (N17-21, N17-22; Ben, 2026-11-18): a payback model only when someone asks Finance. */
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const pricer = makeActor('Pricing'); // OTHER_ID
const lead = makeActor('PricingLead', { userId: KAM_ID });
const mine = makeQuote('QUOTING', { assignedPricerId: OTHER_ID });
const costed = { costingReady: true, roiModelUploadedAt: null };
const open: PaybackRequest = {
  ...EMPTY_PAYBACK_REQUEST,
  requestedBy: OTHER_ID,
  requestedAt: at(0),
};
const codes = (p: { ok: boolean; errors?: { code: string }[] }) =>
  p.ok ? [] : p.errors!.map((e) => e.code);

describe('payback request status', () => {
  it('none → open → received when Finance uploads at or after the request; withdrawn', () => {
    expect(paybackRequestStatus(EMPTY_PAYBACK_REQUEST, null)).toBe('none');
    expect(paybackRequestStatus(open, null)).toBe('open');
    expect(paybackRequestStatus(open, at(-1))).toBe('open'); // uploaded before the request
    expect(paybackRequestStatus(open, at(0))).toBe('received');
    expect(paybackRequestStatus(open, at(5))).toBe('received');
    const withdrawn = { ...open, withdrawnAt: at(1), withdrawnBy: OTHER_ID, withdrawReason: 'x' };
    expect(paybackRequestStatus(withdrawn, at(5))).toBe('withdrawn');
    expect(['none', 'open', 'received', 'withdrawn'].map((s) => paybackNeeded(s as never))).toEqual(
      [false, true, true, false],
    );
  });

  it('reads the request from the decision fields (dates or ISO text)', () => {
    const read = paybackFromFields({
      pricing_record: {
        payback_requested_by: OTHER_ID,
        payback_requested_at: at(0).toISOString(),
        payback_request_note: 'Board pack',
      },
      roi_model_uploaded_at: at(2),
    });
    expect(read.status).toBe('received');
    expect(read.request).toMatchObject({ requestedBy: OTHER_ID, note: 'Board pack' });
    expect(paybackFromFields({}).status).toBe('none');
  });

  it('the hint names why roi_required_when suggests one', () => {
    expect(paybackHintText([])).toBeNull();
    expect(paybackHintText(['Capital is flagged likely'])).toBe(
      'Finance’s payback model may be useful here: Capital is flagged likely',
    );
  });
});

describe('ask Finance for a payback model', () => {
  it('the assigned pricer and any pricing lead may ask; nobody else', () => {
    const asked = planPaybackRequest(pricer, mine, EMPTY_PAYBACK_REQUEST, costed, {}, NOW);
    expect(asked).toEqual({
      ok: true,
      next: { ...EMPTY_PAYBACK_REQUEST, requestedBy: OTHER_ID, requestedAt: NOW },
    });
    expect(planPaybackRequest(lead, mine, EMPTY_PAYBACK_REQUEST, costed, {}, NOW).ok).toBe(true);
    const notMine = makeQuote('QUOTING', { assignedPricerId: KAM_ID });
    expect(
      codes(planPaybackRequest(pricer, notMine, EMPTY_PAYBACK_REQUEST, costed, {}, NOW)),
    ).toEqual(['NOT_PERMITTED']);
    for (const role of ['Finance', 'KAM', 'EngLead', 'Approver', 'Admin'] as const) {
      expect(
        codes(planPaybackRequest(makeActor(role), mine, EMPTY_PAYBACK_REQUEST, costed, {}, NOW)),
        role,
      ).toEqual(['NOT_PERMITTED']);
    }
  });

  it('needs Quoting, the costing model, no open request, and a note of 500 characters at most', () => {
    expect(
      codes(
        planPaybackRequest(
          pricer,
          { ...mine, stageKey: 'FINAL_REVIEW' },
          EMPTY_PAYBACK_REQUEST,
          costed,
          {},
          NOW,
        ),
      ),
    ).toEqual(['WRONG_STAGE']);
    expect(
      codes(
        planPaybackRequest(
          pricer,
          mine,
          EMPTY_PAYBACK_REQUEST,
          { ...costed, costingReady: false },
          {},
          NOW,
        ),
      ),
    ).toEqual(['COSTING_FIRST']);
    expect(codes(planPaybackRequest(pricer, mine, open, costed, {}, NOW))).toEqual([
      'REQUEST_OPEN',
    ]);
    expect(
      codes(
        planPaybackRequest(
          pricer,
          mine,
          EMPTY_PAYBACK_REQUEST,
          costed,
          { note: 'x'.repeat(PAYBACK_NOTE_MAX + 1) },
          NOW,
        ),
      ),
    ).toEqual(['INVALID_VALUE']);
    // A fulfilled or withdrawn request may be followed by a new one; the note is trimmed.
    const again = planPaybackRequest(
      pricer,
      mine,
      open,
      { ...costed, roiModelUploadedAt: at(3) },
      { note: '  New costing  ' },
      at(10),
    );
    expect(again.ok && again.next).toMatchObject({ requestedAt: at(10), note: 'New costing' });
  });

  it('a pricer who has submitted to the lead cannot ask; the lead still can', () => {
    const submitted = { ...mine, pricingSubmittedAt: NOW };
    expect(
      codes(planPaybackRequest(pricer, submitted, EMPTY_PAYBACK_REQUEST, costed, {}, NOW)),
    ).toEqual(['LOCKED_FOR_REVIEW']);
    expect(planPaybackRequest(lead, submitted, EMPTY_PAYBACK_REQUEST, costed, {}, NOW).ok).toBe(
      true,
    );
  });
});

describe('withdraw the request', () => {
  it('only an open request, with a reason', () => {
    const done = planPaybackWithdraw(pricer, mine, open, costed, { reason: ' Not needed ' }, at(5));
    expect(done.ok && done.next).toMatchObject({
      requestedAt: at(0),
      withdrawnAt: at(5),
      withdrawnBy: OTHER_ID,
      withdrawReason: 'Not needed',
    });
    expect(codes(planPaybackWithdraw(pricer, mine, open, costed, { reason: ' ' }, NOW))).toEqual([
      'INVALID_VALUE',
    ]);
    expect(
      codes(planPaybackWithdraw(pricer, mine, EMPTY_PAYBACK_REQUEST, costed, { reason: 'x' }, NOW)),
    ).toEqual(['NO_OPEN_REQUEST']);
    // Finance has uploaded since: nothing to withdraw.
    expect(
      codes(
        planPaybackWithdraw(
          pricer,
          mine,
          open,
          { roiModelUploadedAt: at(1) },
          { reason: 'x' },
          NOW,
        ),
      ),
    ).toEqual(['NO_OPEN_REQUEST']);
    expect(
      codes(planPaybackWithdraw(makeActor('Finance'), mine, open, costed, { reason: 'x' }, NOW)),
    ).toEqual(['NOT_PERMITTED']);
  });
});
