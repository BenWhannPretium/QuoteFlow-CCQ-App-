import { describe, expect, it } from 'vitest';

import {
  CAPACITY_NOT_SIGNED_OFF,
  ENGINEERING_NOT_SUBMITTED,
  capacityHeadline,
  capacitySignoffText,
  partSubmittedText,
} from './engineering-recommendation';
import { absoluteTime } from './time';

/** FB-30 (N19-28): the engineering and capacity recommendations, in the meeting's words. */
describe('the capacity recommendation', () => {
  const at = '2026-11-19T15:00:00Z';

  it('says the sign-off in plain words, with who and when', () => {
    expect(capacitySignoffText({ status: 'approved', byName: 'V. Carroll', at, note: null })).toBe(
      `Capacity is signed off by V. Carroll on ${absoluteTime(at)}`,
    );
    expect(capacitySignoffText({ status: 'blocked', byName: null, at: null, note: 'Full' })).toBe(
      'Capacity is blocked',
    );
  });

  it('is nothing until capacity is signed off (the screen says so)', () => {
    expect(capacitySignoffText({ status: null, byName: null, at: null, note: null })).toBeNull();
    expect(CAPACITY_NOT_SIGNED_OFF).toBe('Not signed off yet');
  });

  const context = {
    siteLabel: 'Aurora',
    cavitation: 4,
    scheduledRunDaysPerYear: 350,
    warnAbovePct: 85,
  };
  const row = {
    site: 'AUR',
    lineAsset: 'Line 3',
    utilizationAfterPct: 78.46,
    utilizationLevel: 'ok' as const,
    cycleTimeS: 12,
    assumedEffectivenessPct: 70,
    scheduledRunDaysPerYear: null,
  };

  it('puts each capacity row in one line: where, the load with this business, the practical capacity', () => {
    // 4 cavities every 12 s = 28,800 parts a day at 100%; at 70% over 350 days = 7,056,000 a year.
    expect(capacityHeadline(row, context)).toBe(
      'Aurora · Line 3: 78.5% loaded with this business, practical capacity 7,056,000 parts a year',
    );
  });

  it('carries the same warning words as the tab', () => {
    expect(
      capacityHeadline({ ...row, utilizationAfterPct: 90, utilizationLevel: 'warn' }, context),
    ).toContain('90.0% loaded with this business (above 85%)');
    expect(
      capacityHeadline({ ...row, utilizationAfterPct: 120, utilizationLevel: 'over' }, context),
    ).toContain('(exceeds line capacity)');
  });

  it('leaves out what cannot be calculated yet', () => {
    expect(
      capacityHeadline(
        { ...row, lineAsset: null, utilizationAfterPct: null, utilizationLevel: null },
        { ...context, cavitation: null },
      ),
    ).toBe('Aurora');
  });
});

describe('the engineering recommendation', () => {
  const part = {
    ownerName: 'A. Engineer',
    submittedAt: null,
    submittedByName: null,
    ownerIsLead: false,
    in: false,
  };

  it('says who submitted it and when, or that it is not submitted yet', () => {
    expect(partSubmittedText(part)).toBe(ENGINEERING_NOT_SUBMITTED);
    const at = '2026-11-19T15:00:00Z';
    expect(
      partSubmittedText({ ...part, submittedAt: at, submittedByName: 'A. Engineer', in: true }),
    ).toBe(`Submitted by A. Engineer on ${absoluteTime(at)}`);
    expect(partSubmittedText({ ...part, ownerIsLead: true, in: true })).toBe(
      'A. Engineer is an engineering lead: no submit needed',
    );
    expect(partSubmittedText(null)).toBeNull();
  });
});
