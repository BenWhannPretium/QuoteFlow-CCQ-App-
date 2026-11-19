import { describe, expect, it } from 'vitest';

import { describeStartupError, syntheticSeedRequested } from './startup';

describe('syntheticSeedRequested', () => {
  it('is off unless SEED_SYNTHETIC_DATA is exactly "true"', () => {
    expect(syntheticSeedRequested({})).toBe(false);
    expect(syntheticSeedRequested({ SEED_SYNTHETIC_DATA: 'false' })).toBe(false);
    expect(syntheticSeedRequested({ SEED_SYNTHETIC_DATA: '1', APP_ENVIRONMENT: 'prod' })).toBe(
      false,
    );
  });

  it('is allowed on test and when the environment is not named', () => {
    expect(syntheticSeedRequested({ SEED_SYNTHETIC_DATA: 'true', APP_ENVIRONMENT: 'test' })).toBe(
      true,
    );
    expect(syntheticSeedRequested({ SEED_SYNTHETIC_DATA: 'true' })).toBe(true);
  });

  it('refuses to seed synthetic data into production', () => {
    expect(() =>
      syntheticSeedRequested({ SEED_SYNTHETIC_DATA: 'true', APP_ENVIRONMENT: 'prod' }),
    ).toThrow(/SEED_SYNTHETIC_DATA=true is forbidden when APP_ENVIRONMENT=prod/);
  });
});

describe('describeStartupError', () => {
  it('names the Postgres code and objects from the cause chain, never the message', () => {
    const pg = Object.assign(new Error('null value in column "x": Failing row (Acme Bottling)'), {
      name: 'PostgresError',
      code: '23502',
      table_name: 'quote',
      column_name: 'kam_user_id',
      detail: 'Failing row contains (Acme Bottling).',
    });
    const wrapped = new Error('Failed query: update quote set …', { cause: pg });
    wrapped.name = 'DrizzleQueryError';
    const line = describeStartupError(wrapped);
    expect(line).toBe('DrizzleQueryError (23502) table_name=quote column_name=kam_user_id');
    expect(line).not.toContain('Acme');
  });

  it('prints a skipped-migration error in full: it names migration tags only', () => {
    const err = new Error('0054_fb26_requote_expiry_handoff not applied: drizzle skips …');
    err.name = 'MigrationsNotAppliedError';
    expect(describeStartupError(err)).toBe(
      'MigrationsNotAppliedError: 0054_fb26_requote_expiry_handoff not applied: drizzle skips …',
    );
  });

  it('falls back to the error name (and a driver code such as ECONNREFUSED)', () => {
    expect(describeStartupError(new TypeError('boom'))).toBe('TypeError');
    expect(describeStartupError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      'Error (ECONNREFUSED)',
    );
    expect(describeStartupError('nope')).toBe('string');
  });
});
