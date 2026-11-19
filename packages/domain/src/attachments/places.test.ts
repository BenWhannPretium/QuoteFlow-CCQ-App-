import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_KINDS_BY_PLACE_SEED,
  attachmentKindAllowedAt,
  parseAttachmentKindsByPlace,
} from './places';
import { settingSpec } from '../config-admin/settings';

describe('attachment_kinds_by_place (FB-24, N17-06/07)', () => {
  it('reads each place in the setting order', () => {
    const parsed = parseAttachmentKindsByPlace({
      intake: ['other', 'bottle_drawing'],
      quote: ['sample_photo'],
    });
    // FB-26: a setting without the hand-off place reads its seed list (the CER proof).
    expect(parsed).toEqual({
      intake: ['other', 'bottle_drawing'],
      quote: ['sample_photo'],
      handoff: ['cer_proof'],
    });
  });

  it('falls back to the seed when missing or malformed, and drops unknown kinds and repeats', () => {
    expect(parseAttachmentKindsByPlace(undefined)).toEqual(ATTACHMENT_KINDS_BY_PLACE_SEED);
    expect(parseAttachmentKindsByPlace(null)).toEqual(ATTACHMENT_KINDS_BY_PLACE_SEED);
    expect(parseAttachmentKindsByPlace(['bottle_drawing'])).toEqual(ATTACHMENT_KINDS_BY_PLACE_SEED);
    const parsed = parseAttachmentKindsByPlace({
      intake: ['nope', 'bid_file', 'bid_file', 3],
      quote: 'other',
    });
    expect(parsed.intake).toEqual(['bid_file']);
    expect(parsed.quote).toEqual(ATTACHMENT_KINDS_BY_PLACE_SEED.quote);
    // A place left with nothing known falls back to its seed.
    expect(parseAttachmentKindsByPlace({ intake: ['nope'] }).intake).toEqual(
      ATTACHMENT_KINDS_BY_PLACE_SEED.intake,
    );
  });

  it("the seed offers Bailey's six at intake, and never Specification or the Engineering / Quoting files", () => {
    expect(ATTACHMENT_KINDS_BY_PLACE_SEED.intake).toEqual([
      'bottle_drawing',
      'sample_photo',
      'bid_file',
      'project_brief',
      'competitor_drawing',
      'other',
    ]);
    for (const kind of [
      'spec',
      'capacity_analysis',
      'equipment_bom',
      'offer_letter',
      'cost_model',
      'roi_model',
      'price_table',
    ]) {
      expect(attachmentKindAllowedAt('intake', kind, undefined), kind).toBe(false);
      expect(attachmentKindAllowedAt('quote', kind, undefined), kind).toBe(false);
    }
    expect(attachmentKindAllowedAt('intake', 'sample_photo', undefined)).toBe(true);
  });

  it('the Admin editor saves only both places, known kinds, once each, without the offer letter', () => {
    const spec = settingSpec('attachment_kinds_by_place');
    // FB-26: a value saved before the hand-off place existed gets its seed list.
    expect(spec.parse({ intake: ['bottle_drawing'], quote: ['other'] })).toEqual({
      intake: ['bottle_drawing'],
      quote: ['other'],
      handoff: ['cer_proof'],
    });
    expect(
      spec.parse({ intake: ['bottle_drawing'], quote: ['other'], handoff: ['cer_proof', 'other'] }),
    ).toEqual({ intake: ['bottle_drawing'], quote: ['other'], handoff: ['cer_proof', 'other'] });
    expect(() => spec.parse({ intake: ['other'], quote: ['other'], handoff: [] })).toThrow();
    expect(() => spec.parse({ intake: ['bottle_drawing'] })).toThrow();
    expect(() => spec.parse({ intake: [], quote: ['other'] })).toThrow();
    expect(() => spec.parse({ intake: ['nope'], quote: ['other'] })).toThrow();
    expect(() => spec.parse({ intake: ['other', 'other'], quote: ['other'] })).toThrow();
    expect(() => spec.parse({ intake: ['offer_letter'], quote: ['other'] })).toThrow();
    expect(() => spec.parse({ intake: ['other'], quote: ['other'], extra: [] })).toThrow();
  });
});
