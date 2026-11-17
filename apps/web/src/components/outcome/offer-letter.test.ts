import type { OfferLetterResponse } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import {
  allAcknowledged,
  blockerFixText,
  blockerTab,
  formWarnings,
  problemLists,
  volumeText,
} from './offer-letter';

const item = (itemNo: number) => ({
  itemId: `019a0000-0000-7000-8000-00000000000${itemNo}`,
  itemNo,
  name: `Item ${itemNo}`,
  partDescription: 'Synthetic bottle',
  placeOfManufacture: 'Plant A',
  annualVolume: 1000,
  piecePricePer1000: '$82.50',
  moldCharge: null,
  changePartsCharge: null,
});

const data = (wordingApproved: boolean, items = [item(1), item(2)]) =>
  ({
    wordingApproved,
    preview: {
      to: 'Synthetic Co',
      date: 'November 16, 2026',
      validUntil: null,
      items,
      labels: {
        piecePrice: 'Piece price per 1,000 pcs',
        molds: 'Molds',
        changeParts: 'Change parts',
      },
      assumptions: [],
    },
  }) satisfies Pick<OfferLetterResponse, 'wordingApproved' | 'preview'>;

describe('offer letter card logic (FB-20)', () => {
  it('asks to acknowledge the wording, Attention and Part # as the server words them', () => {
    const w = formWarnings(data(false), { attention: '', partNumbers: { 1: 'A-1' } });
    expect(w.map((x) => x.code)).toEqual([
      'wording_not_approved',
      'no_attention',
      'no_part_number',
    ]);
    expect(w[2]!.message).toContain('item 2');
    expect(
      formWarnings(data(true), { attention: 'Alex', partNumbers: { 1: 'A-1', 2: 'B-2' } }),
    ).toEqual([]);
  });

  it('treats blank input as missing', () => {
    const w = formWarnings(data(true, [item(1)]), { attention: '  ', partNumbers: { 1: ' ' } });
    expect(w.map((x) => x.code)).toEqual(['no_attention', 'no_part_number']);
  });

  it('needs every warning ticked', () => {
    const w = formWarnings(data(false), { attention: '', partNumbers: {} });
    expect(allAcknowledged(w, new Set(['wording_not_approved']))).toBe(false);
    expect(allAcknowledged(w, new Set(w.map((x) => x.code)))).toBe(true);
    expect(allAcknowledged([], new Set())).toBe(true);
  });

  it('links a blocker to the tab where it is fixed', () => {
    expect(blockerTab('quoting')).toBe('quoting');
    expect(blockerTab('engineering')).toBe('engineering');
    expect(blockerTab('admin')).toBeNull();
    expect(blockerTab(null)).toBeNull();
    expect(blockerFixText('quoting')).toBe('Open the Quoting tab');
    expect(blockerFixText('final_review')).toBeNull();
  });

  it('reads a 409 problem’s blockers and warnings', () => {
    expect(
      problemLists({ blockers: [{ code: 'on_hold', message: 'On hold' }], warnings: 'x' }),
    ).toEqual({ blockers: [{ code: 'on_hold', message: 'On hold' }], warnings: [] });
    expect(problemLists(undefined)).toEqual({ blockers: [], warnings: [] });
  });

  it('formats the volume', () => {
    expect(volumeText(1_200_000)).toBe('1,200,000 pcs');
    expect(volumeText(null)).toBe('–');
  });
});
