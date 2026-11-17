import { PROBLEM_CONTENT_TYPE } from '@ccq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { pgCode, pgProblem } from './pg-error';
import { ServiceProblem } from './problem';
import { buildApp } from '../app';
import { fakeDb, testConfig } from '../test-utils';

/** A driver error as drizzle hands it on: the SQLSTATE sits on the cause, not on the wrapper. */
const wrapped = (code: string, extra: Record<string, unknown> = {}) => {
  const driver = Object.assign(new Error('driver message naming Acme Bottling'), {
    name: 'PostgresError',
    code,
    ...extra,
  });
  const outer = new Error('Failed query: insert into quote …', { cause: driver });
  outer.name = 'DrizzleQueryError';
  return outer;
};

describe('pgCode', () => {
  it('finds the SQLSTATE on the error or anywhere in its cause chain', () => {
    expect(pgCode(wrapped('23505'))).toBe('23505');
    expect(pgCode(Object.assign(new Error('x'), { code: '40P01' }))).toBe('40P01');
  });

  it('ignores codes that are not SQLSTATEs, and non-errors', () => {
    expect(pgCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeUndefined();
    expect(pgCode(new Error('x'))).toBeUndefined();
    expect(pgCode(null)).toBeUndefined();
    expect(pgCode('23505')).toBeUndefined();
  });
});

describe('pgProblem', () => {
  it.each([
    ['23505', 409, 'conflict'],
    ['23503', 409, 'conflict'],
    ['40001', 409, 'conflict_retry'],
    ['40P01', 409, 'conflict_retry'],
    ['22008', 400, 'invalid_value'],
    ['22P02', 400, 'invalid_value'],
    ['22003', 400, 'invalid_value'],
  ])('%s is a %i %s', (sqlstate, status, code) => {
    expect(pgProblem(wrapped(sqlstate))).toMatchObject({ status, code });
  });

  it.each(['23502', '23514', '42P01', '08006', '57014'])(
    '%s stays a server fault (a defect or an outage must look like one)',
    (sqlstate) => {
      expect(pgProblem(wrapped(sqlstate))).toBeNull();
    },
  );
});

describe('the error handler answers an unmapped database collision as a 4xx problem', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const throwing = async (err: () => Error) => {
    app = await buildApp(testConfig(), { db: fakeDb() });
    app.get('/boom', { config: { public: true } }, () => {
      throw err();
    });
    return app.inject({ method: 'GET', url: '/boom' });
  };

  it('a unique violation is a 409 that never quotes the database', async () => {
    const res = await throwing(() => wrapped('23505', { detail: 'Key (name)=(Acme Bottling)' }));
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.json()).toMatchObject({ status: 409, code: 'conflict' });
    expect(res.body).not.toContain('Acme');
    expect(res.body).not.toContain('Failed query');
  });

  it('a deadlock is a 409 the client may retry; a bad value is a 400', async () => {
    expect((await throwing(() => wrapped('40P01'))).json()).toMatchObject({
      status: 409,
      code: 'conflict_retry',
    });
    await app?.close();
    expect((await throwing(() => wrapped('22008'))).json()).toMatchObject({
      status: 400,
      code: 'invalid_value',
    });
  });

  it('a NOT NULL violation is still a 500 with no detail', async () => {
    const res = await throwing(() => wrapped('23502'));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('Acme');
  });

  it("a service's own problem is left alone, whatever database error it wraps", async () => {
    const res = await throwing(() =>
      Object.assign(
        new ServiceProblem(409, 'override_conflict', 'Already waiting for a decision'),
        {
          cause: wrapped('23505'),
        },
      ),
    );
    // Routes turn a ServiceProblem into its own response (`handleProblems`); if one ever reaches this
    // handler it must not be rewritten as a generic database conflict because of what it wraps.
    expect(res.json<{ code?: string }>().code).not.toBe('conflict');
    expect(res.body).not.toContain('changed by someone else');
  });
});
