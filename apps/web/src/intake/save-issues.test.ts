import type { IntakeDraftData } from '@ccq/contracts';
import type { IntakeEvaluation } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { saveProblemIssues, withSaveIssues, type SaveIssue } from './model';

/** The API's answer to an autosave with a value outside what it accepts (RFC 9457, with `errors`). */
const refused = (...errors: { path: string; message: string }[]) => ({
  type: 'about:blank',
  title: 'Validation failed',
  status: 400,
  detail: 'Request body is invalid',
  errors,
});

const KEY = (n: number) => `0193f2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('saveProblemIssues (UX-017: a refused autosave names its field)', () => {
  it('maps the JSON pointer to the form field and words it "Label: what to enter"', () => {
    expect(
      saveProblemIssues(
        refused({ path: '/data/estAnnualRevenue', message: 'Enter 999999999999.99 or less' }),
      ),
    ).toEqual([
      {
        code: 'INVALID_VALUE',
        field: 'est_annual_revenue',
        message: 'Estimated annual revenue: enter 999,999,999,999.99 or less',
      },
    ]);
  });

  it('does not repeat a label the server already gave, and maps nested paths', () => {
    expect(
      saveProblemIssues(
        refused(
          { path: '/data/shipTo/state', message: 'Use 100 characters or fewer' },
          { path: '/data/resin', message: 'Resin: pick one of the options' },
        ),
      ),
    ).toEqual([
      {
        code: 'INVALID_VALUE',
        field: 'ship_to.state',
        message: 'Destination state: use 100 characters or fewer',
      },
      { code: 'INVALID_VALUE', field: 'resin', message: 'Resin: pick one of the options' },
    ]);
  });

  it('names the item on an intake with several items, and not on an intake with one', () => {
    const problem = refused({
      path: '/data/items/1/estAnnualVolume',
      message: 'Enter 1000000000000 or less',
    });
    const two: IntakeDraftData = {
      items: [
        { key: KEY(1), label: '16 oz bottle' },
        { key: KEY(2), label: '24 oz bottle' },
      ],
    };
    expect(saveProblemIssues(problem, two)).toEqual([
      {
        code: 'INVALID_VALUE',
        field: 'est_annual_volume',
        item: 2,
        message: 'Item 2 (24 oz bottle): Estimated annual volume: enter 1,000,000,000,000 or less',
      },
    ]);
    const one: IntakeDraftData = { items: [{ key: KEY(1), label: '16 oz bottle' }] };
    expect(
      saveProblemIssues(
        refused({ path: '/data/items/0/estAnnualVolume', message: 'Enter 1000000000000 or less' }),
        one,
      ),
    ).toEqual([
      {
        code: 'INVALID_VALUE',
        field: 'est_annual_volume',
        message: 'Estimated annual volume: enter 1,000,000,000,000 or less',
      },
    ]);
  });

  it('lists a field once, and leaves out what is not a field of the form', () => {
    expect(
      saveProblemIssues(
        refused(
          { path: '/data/estAnnualRevenue', message: 'Enter 999999999999.99 or less' },
          { path: '/data/estAnnualRevenue', message: 'Enter a number' },
          { path: '/data/somethingNew', message: 'This value is not valid' },
          { path: '/', message: 'This value is not valid' },
        ),
      ).map((i) => i.field),
    ).toEqual(['est_annual_revenue']);
  });

  it('is empty for a problem with no field errors (a 500, a network failure)', () => {
    expect(saveProblemIssues({ type: 'about:blank', title: 'Server error', status: 500 })).toEqual(
      [],
    );
  });
});

describe('withSaveIssues', () => {
  const clean: IntakeEvaluation = { blocking: [], warnings: [], ready: true };
  const issue: SaveIssue = {
    code: 'INVALID_VALUE',
    field: 'est_annual_revenue',
    message: 'Estimated annual revenue: enter 999,999,999,999.99 or less',
  };

  it('returns the evaluation itself when the server refused nothing', () => {
    expect(withSaveIssues(clean, [])).toBe(clean);
  });

  it('adds the refused field to the blocking list, so Submit waits for it', () => {
    expect(withSaveIssues(clean, [issue])).toEqual({
      blocking: [issue],
      warnings: [],
      ready: false,
    });
  });

  it('does not list a field the wizard already flags the same way', () => {
    const flagged: IntakeEvaluation = {
      blocking: [{ ...issue, message: 'Estimated annual revenue is too large' }],
      warnings: [],
      ready: false,
    };
    expect(withSaveIssues(flagged, [issue])).toBe(flagged);
  });
});
