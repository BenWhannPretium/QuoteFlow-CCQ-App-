import { z } from 'zod';

import { ATTACHMENT_KINDS, type AttachmentKind } from './file-types';

/**
 * FB-24 (N17-06, N17-07, Bailey Schmitt): which file types each place offers (app_setting
 * `attachment_kinds_by_place`, provisional). `intake`: the intake's files; the server refuses any other
 * kind on a draft (422). `quote`: the quote's Attachments tab (only its dropdown; the server keeps the
 * quote's own rules). Specification is offered nowhere for now; a file already stored keeps its label.
 * Capacity analysis lives on Engineering's capacity rows, the equipment BOM in Engineering, the models in
 * Quoting, and the offer letter is generated. FB-26 (N17-32): `handoff`: the hand-off card's files (the
 * CER proof). A setting saved before FB-26 has no `handoff` list and reads the seed.
 */
export const ATTACHMENT_PLACES = ['intake', 'quote', 'handoff'] as const;
export type AttachmentPlace = (typeof ATTACHMENT_PLACES)[number];

export type AttachmentKindsByPlace = Record<AttachmentPlace, AttachmentKind[]>;

/** The seed (the same lists as `ATTACHMENT_KINDS_BY_PLACE` in the config seed and migration 0051). */
export const ATTACHMENT_KINDS_BY_PLACE_SEED: Readonly<AttachmentKindsByPlace> = {
  intake: [
    'bottle_drawing',
    'sample_photo',
    'bid_file',
    'project_brief',
    'competitor_drawing',
    'other',
  ],
  quote: [
    'bottle_drawing',
    'sample_photo',
    'bid_file',
    'project_brief',
    'competitor_drawing',
    'other',
  ],
  handoff: ['cer_proof'],
};

const isKind = (v: unknown): v is AttachmentKind =>
  typeof v === 'string' && (ATTACHMENT_KINDS as readonly string[]).includes(v);

/**
 * The setting as each place's kinds, in the setting's order. Lenient (a page or an upload must not fail
 * on a bad row): a missing or malformed place falls back to its seed list, unknown kinds and repeats are
 * dropped, and a place left with no kind falls back to its seed.
 */
export function parseAttachmentKindsByPlace(setting: unknown): AttachmentKindsByPlace {
  const raw =
    setting && typeof setting === 'object' && !Array.isArray(setting)
      ? (setting as Record<string, unknown>)
      : {};
  const out = {} as AttachmentKindsByPlace;
  for (const place of ATTACHMENT_PLACES) {
    const list = raw[place];
    const kinds = Array.isArray(list) ? [...new Set(list.filter(isKind))] : [];
    out[place] = kinds.length > 0 ? kinds : [...ATTACHMENT_KINDS_BY_PLACE_SEED[place]];
  }
  return out;
}

/** True when `kind` may be added at `place` under the setting. */
export function attachmentKindAllowedAt(
  place: AttachmentPlace,
  kind: string,
  setting: unknown,
): boolean {
  return (parseAttachmentKindsByPlace(setting)[place] as readonly string[]).includes(kind);
}

/**
 * The strict reading the Admin settings editor saves through: both places, each a non-empty list of
 * known kinds without repeats. The generated offer letter is never an upload kind.
 */
const placeKinds = z
  .array(z.enum(ATTACHMENT_KINDS))
  .min(1, 'List at least one file type')
  .refine((l) => new Set(l).size === l.length, 'List each file type once')
  .refine((l) => !l.includes('offer_letter'), 'The offer letter is generated, not uploaded');

export const attachmentKindsByPlaceSchema = z
  // FB-26: a value saved before the hand-off place existed reads the seed list for it.
  .object({ intake: placeKinds, quote: placeKinds, handoff: placeKinds.default(['cer_proof']) })
  .strict() satisfies z.ZodType<AttachmentKindsByPlace>;
