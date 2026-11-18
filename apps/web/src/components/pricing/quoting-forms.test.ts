import { describe, expect, it } from 'vitest';

import { capitalComparable, capitalForm, recordComparable, splitRefs } from './quoting-forms';

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

describe('capitalComparable', () => {
  const stored = capitalForm({
    capitalReadiness: 'pre_approved',
    capitalNotes: 'Board slot booked',
  });

  it('a justification typed under Pending and left behind is not a change', () => {
    // Pick Pending, type why, pick Pre-approved again: the field is hidden and the server drops it.
    const form = { ...stored, capitalPendingJustification: 'Waiting for the CER number' };
    expect(same(capitalComparable(form), capitalComparable(stored))).toBe(true);
  });

  it('a justification is a change while the status is Pending', () => {
    const form = {
      ...stored,
      capitalReadiness: 'pending',
      capitalPendingJustification: 'Waiting for the CER number',
    };
    expect(same(capitalComparable(form), capitalComparable(stored))).toBe(false);
  });

  it('spaces around the notes are not a change', () => {
    const form = { ...stored, capitalNotes: '  Board slot booked ' };
    expect(same(capitalComparable(form), capitalComparable(stored))).toBe(true);
  });

  it('reads an empty record as an empty form', () => {
    expect(capitalForm(null)).toEqual({
      capitalReadiness: '',
      capitalNotes: '',
      capitalPendingJustification: '',
    });
  });
});

describe('recordComparable', () => {
  const stored = {
    approvedBy: 'user-1',
    approvedAt: '2026-11-17T10:00',
    pricingBasisNote: 'Resin index for November',
    approvedRangeNote: '',
    erfRefs: 'ERF-1, ERF-2',
    costingCompleted: true,
  };

  it('spaces and the way references are separated are not a change', () => {
    const form = {
      ...stored,
      pricingBasisNote: ' Resin index for November  ',
      erfRefs: 'ERF-1;ERF-2,',
    };
    expect(same(recordComparable(form), recordComparable(stored))).toBe(true);
  });

  it('a different note, reference or tick is', () => {
    expect(same(recordComparable({ ...stored, erfRefs: 'ERF-1' }), recordComparable(stored))).toBe(
      false,
    );
    expect(
      same(recordComparable({ ...stored, costingCompleted: false }), recordComparable(stored)),
    ).toBe(false);
  });

  it('splitRefs drops blanks', () => {
    expect(splitRefs(' ERF-1,, ERF-2\n')).toEqual(['ERF-1', 'ERF-2']);
  });
});
