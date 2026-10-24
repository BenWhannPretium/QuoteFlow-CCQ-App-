import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MAPPED_OBJECTS, OPPORTUNITY_OBJECT, PRODUCT_SPEC_OBJECT, type FieldRef } from './fieldMap';
import {
  JsforceSalesforceReader,
  describedFieldFor,
  sfApiFactory,
  type SfApi,
  type SfQueryResult,
} from './jsforce';
import { jwtAssertion, jwtLogin } from './jwt';
import { SfAuthError, clientCredentialsLogin } from './oauth';
import type { SfLogger } from './reader';
import { isRetryable, sfErrorCode, withRetry, withTimeout } from './retry';

type Raw = Record<string, unknown>;

/** Every mapped field exists (as describe() would report it). */
function describeAll(): Record<string, string[] | null> {
  return Object.fromEntries(
    Object.entries(MAPPED_OBJECTS).map(([obj, map]) => [
      obj,
      Object.values<FieldRef>(map).map((r) => describedFieldFor(r.path)),
    ]),
  );
}

const opp = (n: number): Raw => ({
  attributes: { type: 'Opportunity' },
  Id: `006000000000${String(n).padStart(3, '0')}AAA`,
  Name: `Opp ${n}`,
  AccountId: null,
  Amount: n * 1000,
  StageName: 'Quoting',
  IsClosed: false,
  IsWon: false,
  SystemModstamp: '2026-10-15T15:00:00.000+0000',
});

/** A stub of the read-only API: canned pages, scripted failures, recorded SOQL. */
function stubApi(opts: {
  pages?: Raw[][];
  fields?: Record<string, string[] | null>;
  failQuery?: Error[];
  deleted?: { id: string }[];
}) {
  const soql: string[] = [];
  const failures = [...(opts.failQuery ?? [])];
  const pages = opts.pages ?? [[opp(1)]];
  const fields = opts.fields ?? describeAll();
  const page = (i: number): SfQueryResult => ({
    records: pages[i] ?? [],
    done: i >= pages.length - 1,
    nextRecordsUrl: i < pages.length - 1 ? `/query/01g-${i + 1}` : undefined,
  });
  const api: SfApi = {
    query: (q) => {
      soql.push(q);
      const failure = failures.shift();
      return failure ? Promise.reject(failure) : Promise.resolve(page(0));
    },
    queryMore: (locator) => Promise.resolve(page(Number(locator.split('-').pop()))),
    describeFields: (name) => Promise.resolve(name in fields ? fields[name]! : null),
    deleted: vi.fn(() => Promise.resolve(opts.deleted ?? [])),
  };
  return { api, soql };
}

const noSleep = { sleep: () => Promise.resolve(), baseDelayMs: 1 };

function recordingLogger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const logger: SfLogger = {
    info: (obj, msg) => lines.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj, msg }),
  };
  return { logger, lines };
}

describe('JsforceSalesforceReader', () => {
  it('follows queryMore until done', async () => {
    const { api } = stubApi({ pages: [[opp(1), opp(2)], [opp(3)], [opp(4)]] });
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api), { retry: noSleep });
    const pages = [];
    for await (const page of reader.listChangedOpportunities(null)) pages.push(page.length);
    expect(pages).toEqual([2, 1, 1]);
  });

  it('retries REQUEST_LIMIT_EXCEEDED and 5xx with backoff, logging codes only', async () => {
    const { api, soql } = stubApi({
      failQuery: [
        Object.assign(new Error('Too many requests: details with data'), {
          errorCode: 'REQUEST_LIMIT_EXCEEDED',
        }),
        Object.assign(new Error('Service Unavailable'), { name: 'ERROR_HTTP_503' }),
      ],
    });
    const { logger, lines } = recordingLogger();
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api), {
      retry: noSleep,
      logger,
    });
    const results = await reader.searchOpportunities({ q: 'opp', openOnly: true, limit: 5 });
    expect(results).toHaveLength(1);
    expect(soql).toHaveLength(3);
    expect(
      lines.filter((l) => l.msg === 'salesforce call retrying').map((l) => l.obj.code),
    ).toEqual(['REQUEST_LIMIT_EXCEEDED', 'ERROR_HTTP_503']);
    expect(JSON.stringify(lines)).not.toContain('details with data');
  });

  it('does not retry a non-transient error', async () => {
    const { api, soql } = stubApi({
      failQuery: [Object.assign(new Error('bad field'), { errorCode: 'INVALID_FIELD' })],
    });
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api), { retry: noSleep });
    await expect(reader.getOpportunity('006000000000001AAA')).rejects.toThrow('bad field');
    expect(soql).toHaveLength(1);
  });

  it('logs in again once when the session expires', async () => {
    const expired = Object.assign(new Error('expired'), { errorCode: 'INVALID_SESSION_ID' });
    const first = stubApi({ failQuery: [expired, expired, expired, expired] });
    const second = stubApi({});
    const connect = vi
      .fn<() => Promise<SfApi>>()
      .mockResolvedValueOnce(first.api)
      .mockResolvedValueOnce(second.api);
    const reader = new JsforceSalesforceReader(connect, { retry: noSleep });
    expect(await reader.getOpportunity('006000000000001AAA')).not.toBeNull();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('drops custom fields missing from the org and says which (field names only)', async () => {
    const fields = describeAll();
    fields[OPPORTUNITY_OBJECT] = fields[OPPORTUNITY_OBJECT]!.filter((f) => f !== 'ERF_Number__c');
    const { api, soql } = stubApi({ fields });
    const { logger, lines } = recordingLogger();
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api), { logger });
    await reader.getOpportunity('006000000000001AAA');
    expect(soql[0]).not.toContain('ERF_Number__c');
    expect(soql[0]).toContain('Quote_Type__c');
    expect(lines.find((l) => l.obj.object === OPPORTUNITY_OBJECT)?.obj.missingFields).toEqual([
      'ERF_Number__c',
    ]);
    expect(await reader.unresolvedFields()).toEqual(['Opportunity.ERF_Number__c']);
  });

  it('product specs: [] while the custom object is not in the org (pending M3)', async () => {
    const fields = describeAll();
    fields[PRODUCT_SPEC_OBJECT] = null;
    const { api, soql } = stubApi({ fields });
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api));
    expect(await reader.getProductSpecs('006000000000001AAA')).toEqual([]);
    expect(soql).toHaveLength(0);
  });

  it('clamps the getDeleted window to what SF keeps (~30 days)', async () => {
    const { api } = stubApi({ deleted: [{ id: '006000000000009AAA' }] });
    const now = new Date('2026-10-15T00:00:00Z');
    const reader = new JsforceSalesforceReader(() => Promise.resolve(api), { now: () => now });
    const ids = await reader.listDeletedOpportunityIds(new Date('2026-01-01T00:00:00Z'), now);
    expect(ids).toEqual(['006000000000009AAA']);
    const [, start] = (api.deleted as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, Date];
    expect(start.toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });
});

describe('retry helpers', () => {
  it('classifies errors', () => {
    expect(isRetryable({ errorCode: 'REQUEST_LIMIT_EXCEEDED' })).toBe(true);
    expect(isRetryable({ statusCode: 502 })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ errorCode: 'INVALID_FIELD' })).toBe(false);
    expect(isRetryable({ statusCode: 400 })).toBe(false);
    expect(sfErrorCode(new Error('message with customer data'))).toBe('UNKNOWN');
    expect(sfErrorCode({ cause: { code: '42P01' } })).toBe('DB_42P01');
  });

  it('times out a call after the limit', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow('timed out after 5 ms');
  });

  it('gives up after the retry budget', async () => {
    const fn = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { statusCode: 503 })));
    await expect(withRetry(fn, { ...noSleep, retries: 2 })).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('JWT bearer login', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const config = {
    clientId: 'consumer-key',
    username: 'integration@pretiumpkg.com.uat',
    privateKey: pem.replace(/\n/g, '\\n'), // single-line env form
    loginUrl: 'https://test.salesforce.com/',
  };

  it('signs an RS256 assertion with the connected-app claims', () => {
    const now = new Date('2026-10-15T15:00:00Z');
    const jwt = jwtAssertion(config, now);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      iss: 'consumer-key',
      sub: 'integration@pretiumpkg.com.uat',
      aud: 'https://test.salesforce.com',
      exp: now.getTime() / 1000 + 180,
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
  });

  it('exchanges the assertion for a session', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'tok',
            instance_url: 'https://pretiumpkg--uat.my.salesforce.com',
          }),
          { status: 200 },
        ),
      ),
    );
    const session = await jwtLogin(config, fetchImpl);
    expect(session).toEqual({
      accessToken: 'tok',
      instanceUrl: 'https://pretiumpkg--uat.my.salesforce.com',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://test.salesforce.com/services/oauth2/token');
    expect((init.body as URLSearchParams).toString()).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    );
  });

  it('reports the SF error code only (the description can echo the username)', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: "user hasn't approved this consumer",
          }),
          { status: 400 },
        ),
      );
    const err = await jwtLogin(config, fetchImpl as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SfAuthError);
    expect((err as Error).message).toBe('Salesforce JWT login failed: invalid_grant (HTTP 400)');
  });
});

describe('client credentials login', () => {
  const config = {
    clientId: 'consumer-key',
    clientSecret: 'consumer-secret',
    loginUrl: 'https://pretiumpkg.my.salesforce.com/',
  };
  const ok = () =>
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'tok',
            instance_url: 'https://pretiumpkg.my.salesforce.com',
          }),
          { status: 200 },
        ),
      ),
    );

  it('posts the client credentials grant to the My Domain token endpoint', async () => {
    const fetchImpl = ok();
    const session = await clientCredentialsLogin(config, fetchImpl);
    expect(session).toEqual({
      accessToken: 'tok',
      instanceUrl: 'https://pretiumpkg.my.salesforce.com',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pretiumpkg.my.salesforce.com/services/oauth2/token');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('consumer-key');
    expect(body.get('client_secret')).toBe('consumer-secret');
  });

  it('reports the SF error code only, never the secret', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'invalid client credentials',
          }),
          { status: 400 },
        ),
      );
    const err = await clientCredentialsLogin(config, fetchImpl as typeof fetch).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SfAuthError);
    expect((err as Error).message).toBe(
      'Salesforce client credentials login failed: invalid_client (HTTP 400)',
    );
    expect((err as Error).message).not.toContain('consumer-secret');
  });

  it('sfApiFactory logs in with the configured flow', async () => {
    const fetchImpl = ok();
    await sfApiFactory({ flow: 'client_credentials', ...config }, fetchImpl)();
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
  });
});
