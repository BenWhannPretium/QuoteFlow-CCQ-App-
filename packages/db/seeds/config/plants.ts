/**
 * FB-13 (F-057): the plant and machine-type lists, exactly as Jim Zweifel sent them on 2026-11-10
 * (QuoteFlow Plants and Process.xlsx, dated 11.10.26; Ben Whann confirmed it is correct). Nothing here is
 * questioned or "fixed": "12B" at St. Charles and the spelling "Etten.Leur" are as sent, and the list has
 * 22 locations (no check against the old "about 29" figure). The record is
 * docs/build-guide/feedback/inputs/plants-machine-types.md. Migration 0039 carries the same data to
 * existing environments; the seed test compares the two.
 */
export const PLANT_LIST_APPROVER = 'Jim Zweifel';
export const PLANT_LIST_APPROVED_AT = new Date('2026-11-10T00:00:00Z');

/** Jim's machine types: [code, label], in his order. The label is as sent. */
export const MACHINE_TYPES: readonly [code: string, label: string][] = [
  ['EBM', 'EBM'],
  ['IBM', 'IBM'],
  ['ISBM', 'ISBM'],
  ['RHB', 'RHB'],
  ['INJ-CAP', 'INJ - CAP'],
  ['INJ-PREFORM', 'INJ - PREFORM'],
  ['INJ-OTHER', 'INJ - OTHER'],
  ['DECO', 'DECO'],
  ['PAD PRINTING', 'PAD PRINTING'],
  ['12B', '12B'],
  ['DIE CUTTING', 'DIE CUTTING'],
  ['LAMINATION', 'LAMINATION'],
  ['PRINTING', 'PRINTING'],
  ['STAMPING', 'STAMPING'],
];

/** A stable code for a location name: upper-snake ("Cleveland, OH" is CLEVELAND_OH, "Etten.Leur" ETTEN_LEUR). */
export const plantCode = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** The 22 locations in Jim's order, each with its machine-type codes (`MACHINE_TYPES`) as sent. */
export const PLANTS: readonly { name: string; machineTypes: readonly string[] }[] = [
  { name: 'Aurora', machineTypes: ['EBM'] },
  { name: 'Bethlehem', machineTypes: ['EBM', 'IBM', 'ISBM'] },
  { name: 'Boxmore', machineTypes: ['EBM', 'IBM', 'INJ-CAP', 'PAD PRINTING'] },
  { name: 'Carrollton', machineTypes: ['EBM', 'ISBM', 'RHB'] },
  { name: 'Cleveland, OH', machineTypes: ['EBM', 'INJ-PREFORM', 'RHB'] },
  { name: 'Cleveland, TN', machineTypes: ['IBM', 'INJ-OTHER'] },
  { name: 'Lerma, Ediplast', machineTypes: ['EBM', 'INJ-PREFORM', 'ISBM', 'RHB', 'DECO'] },
  {
    name: 'Lerma, Ediprint',
    machineTypes: ['DIE CUTTING', 'LAMINATION', 'PRINTING', 'STAMPING'],
  },
  { name: 'Etten.Leur', machineTypes: ['ISBM', 'RHB'] },
  { name: 'Greensboro', machineTypes: ['EBM'] },
  { name: 'Hazleton', machineTypes: ['ISBM', 'RHB'] },
  { name: 'Hillsborough', machineTypes: ['IBM', 'ISBM', 'INJ-CAP', 'INJ-OTHER'] },
  { name: 'Leipsic', machineTypes: ['EBM'] },
  { name: 'Manchester', machineTypes: ['EBM', 'ISBM'] },
  { name: 'Peru', machineTypes: ['ISBM'] },
  { name: 'Salt Lake City', machineTypes: ['EBM', 'IBM', 'ISBM', 'RHB'] },
  { name: 'St. Charles', machineTypes: ['12B', 'INJ-CAP', 'ISBM', 'RHB', 'DECO'] },
  { name: 'St. Laurent', machineTypes: ['EBM', 'IBM'] },
  { name: 'St. Louis', machineTypes: ['IBM', 'INJ-CAP', 'ISBM'] },
  { name: 'Toronto', machineTypes: ['EBM', 'IBM', 'INJ-OTHER'] },
  { name: 'Troy', machineTypes: ['EBM', 'RHB'] },
  { name: 'Vancouver', machineTypes: ['EBM', 'IBM', 'ISBM'] },
];

/** The placeholder plants this replaces (kept inactive: old quotes show their label). */
export const RETIRED_PLANTS = ['PLANT_01', 'PLANT_02', 'PLANT_03'] as const;

/** The placeholder machine types this replaces (kept inactive). EBM_WHEEL was already inactive (FB-03). */
export const RETIRED_MACHINE_TYPES = [
  'EBM_SHUTTLE',
  'EBM_WHEEL',
  'IBM_PRESS',
  'ISBM_1STEP',
  'ISBM_2STEP',
  'INJECTION_PRESS',
  'OTHER',
] as const;
