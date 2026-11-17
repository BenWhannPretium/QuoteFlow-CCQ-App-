import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { AppConfig } from './config';
import { REDACTED, loggerOptions, redactSensitive, serializeError } from './logger';

describe('redactSensitive', () => {
  it('masks price and token keys at any depth', () => {
    const out = redactSensitive({
      quote: { unitPrice: 1.23, priceApproved: true, lines: [{ netPrice: 4 }] },
      auth: { accessToken: 'abc', refresh_token: 'def' },
      keep: 'me',
    });
    expect(out).toEqual({
      quote: { unitPrice: REDACTED, priceApproved: REDACTED, lines: [{ netPrice: REDACTED }] },
      auth: { accessToken: REDACTED, refresh_token: REDACTED },
      keep: 'me',
    });
  });

  it('leaves primitives untouched', () => {
    expect(redactSensitive('price')).toBe('price');
  });

  it('passes errors and dates through instead of rebuilding them as {}', () => {
    const err = new Error('boom');
    const at = new Date('2026-11-17T15:00:00Z');
    const out = redactSensitive({ err, at, nested: { err } }) as {
      err: unknown;
      at: unknown;
      nested: { err: unknown };
    };
    expect(out.err).toBe(err);
    expect(out.at).toBe(at);
    expect(out.nested.err).toBe(err);
  });
});

describe('serializeError', () => {
  it('keeps what failed and drops the Postgres fields that can echo row data', () => {
    const pg = Object.assign(new Error('null value in column "kam_user_id" violates not-null'), {
      code: '23502',
      table_name: 'quote',
      column_name: 'kam_user_id',
      detail: 'Failing row contains (Acme Bottling, 4.25, …).',
      where: 'SQL statement "insert into quote …"',
      query: 'insert into quote values ($1)',
      parameters: ['Acme Bottling'],
      accessToken: 'eyJ…',
    });
    const out = serializeError(pg) as Record<string, unknown>;
    expect(out).toMatchObject({
      type: 'Error',
      message: 'null value in column "kam_user_id" violates not-null',
      code: '23502',
      table_name: 'quote',
      column_name: 'kam_user_id',
      accessToken: REDACTED,
    });
    expect(out.stack).toContain('logger.test.ts');
    expect(JSON.stringify(out)).not.toContain('Acme Bottling');
  });
});

describe('serializeError on a failed database statement', () => {
  // drizzle's wrapper puts the SQL text and its bound values in the message (and so at the head of the
  // stack) and on `query` / `params`. None of that may reach the log.
  const failedStatement = () => {
    const driver = Object.assign(
      new Error('duplicate key value violates unique constraint "customer_name_uidx"'),
      {
        name: 'PostgresError',
        code: '23505',
        constraint_name: 'customer_name_uidx',
        table_name: 'customer',
        detail: 'Key (name)=(Acme Bottling) already exists.',
        query: 'insert into customer (name, est_annual_revenue) values ($1, $2)',
        parameters: ['Acme Bottling', '4250000.25'],
      },
    );
    const sqlText = 'insert into "customer" ("name", "est_annual_revenue") values ($1, $2)';
    const wrapper = Object.assign(
      new Error(`Failed query: ${sqlText}\nparams: Acme Bottling,4250000.25`, { cause: driver }),
      { query: sqlText, params: ['Acme Bottling', 4250000.25] },
    );
    return wrapper;
  };

  it('withholds the statement and its values, and keeps what failed', () => {
    const out = serializeError(failedStatement()) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toContain('Acme');
    expect(text).not.toContain('4250000');
    expect(text).not.toContain('insert into');
    expect(out.message).toBe('Failed query (statement and parameters withheld; see cause)');
    expect(out.code).toBe('23505');
    expect(out.cause).toMatchObject({
      type: 'PostgresError',
      message: 'duplicate key value violates unique constraint "customer_name_uidx"',
      code: '23505',
      constraint_name: 'customer_name_uidx',
      table_name: 'customer',
    });
    expect(out.stack).toContain('logger.test.ts');
  });

  it('is what a request logs through the production logger', async () => {
    const lines: string[] = [];
    const options = loggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' } as AppConfig);
    const app = Fastify({
      logger: { ...(options as object), stream: { write: (line: string) => lines.push(line) } },
    });
    app.get('/boom', (request) => {
      request.log.error({ err: failedStatement() }, 'unhandled error');
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    const everything = lines.join('\n');
    expect(everything).toContain('"code":"23505"');
    expect(everything).not.toContain('Acme');
    expect(everything).not.toContain('insert into');
  });
});

describe('loggerOptions (production shape)', () => {
  // Regression: every production log line carried "req":{}, "err":{} and "res":{}, so a 500 could not
  // be diagnosed from the logs. This drives a real Fastify logger and reads what it writes.
  it('logs the error, the request and the response, without the query string', async () => {
    const lines: string[] = [];
    const options = loggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' } as AppConfig);
    const app = Fastify({
      logger: { ...(options as object), stream: { write: (line: string) => lines.push(line) } },
    });
    app.get('/quotes/:n', (request) => {
      request.log.error(
        { err: new Error('relation "quote" does not exist'), unitPrice: 4.25 },
        'unhandled error',
      );
      return { ok: true };
    });
    const res = await app.inject({
      method: 'GET',
      url: '/quotes/CCQ-2026-00001?q=Acme%20Bottling',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();

    const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const incoming = logged.find((l) => l.msg === 'incoming request');
    const failure = logged.find((l) => l.msg === 'unhandled error');
    const completed = logged.find((l) => l.msg === 'request completed');

    expect(incoming?.req).toMatchObject({ method: 'GET', url: '/quotes/CCQ-2026-00001' });
    expect(failure?.err).toMatchObject({
      type: 'Error',
      message: 'relation "quote" does not exist',
    });
    expect((failure?.err as { stack: string }).stack).toContain('logger.test.ts');
    expect(failure?.unitPrice).toBe(REDACTED);
    expect(completed?.res).toMatchObject({ statusCode: 200 });

    const everything = lines.join('\n');
    expect(everything).not.toContain('Acme');
    expect(everything).not.toContain('secret-token');
  });
});
