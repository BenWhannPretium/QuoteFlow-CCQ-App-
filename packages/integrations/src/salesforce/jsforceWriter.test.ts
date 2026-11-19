import { describe, expect, it, vi } from 'vitest';

import { FakeSalesforceWriter } from './fakeWriter';
import { JsforceSalesforceWriter, type SfWriteApi } from './jsforceWriter';
import { sfWriteHostProblem } from './writer';

// Placeholders only: no real org URL or credential.
const SANDBOX = 'https://example--uat.sandbox.my.salesforce.com';
const PROD = 'https://example.my.salesforce.com';
const OPP = '006000000000001AAA';

/** A stubbed write API and its `update` spy (kept apart: the read-only lint rule flags `x.update`). */
function stub(instanceUrl: string, over: Partial<SfWriteApi> = {}) {
  const save = vi.fn((_object: string, _record: Record<string, string>) =>
    Promise.resolve({ success: true, errors: [] as unknown[] }),
  );
  const api: SfWriteApi = {
    instanceUrl,
    update: save,
    stageOf: () => Promise.resolve({ found: true, stage: 'Negotiating' }),
    ...over,
  };
  return { api, save };
}

describe('sfWriteHostProblem', () => {
  it('outside prod allows only a sandbox My Domain', () => {
    expect(sfWriteHostProblem(SANDBOX, 'test')).toBeNull();
    expect(sfWriteHostProblem(PROD, 'test')).toMatch(/sandbox/);
    expect(sfWriteHostProblem(PROD, 'prod')).toBeNull();
    expect(sfWriteHostProblem('https://test.salesforce.com', 'test')).toMatch(/cannot be used/);
    expect(sfWriteHostProblem('https://login.salesforce.com', 'prod')).toMatch(/cannot be used/);
    expect(sfWriteHostProblem('http://example--uat.sandbox.my.salesforce.com', 'test')).toMatch(
      /https/,
    );
    expect(sfWriteHostProblem('https://example.com', 'prod')).toMatch(/My Domain/);
  });
});

describe('JsforceSalesforceWriter', () => {
  it('writes an allow-listed field through its own session', async () => {
    const { api, save } = stub(SANDBOX);
    const writer = new JsforceSalesforceWriter(() => Promise.resolve(api), { appEnvironment: 'test' });
    expect(await writer.updateOpportunity(OPP, { StageName: 'Closed Lost' }, { dedupeKey: 'k' })).toEqual(
      { ok: true },
    );
    expect(save).toHaveBeenCalledWith('Opportunity', { Id: OPP, StageName: 'Closed Lost' });
    expect(await writer.getCurrentStage(OPP)).toEqual({ ok: true, stage: 'Negotiating' });
  });

  it('refuses a field off the allow-list, a figure and a bad id without a call', async () => {
    const { api } = stub(SANDBOX);
    const connect = vi.fn(() => Promise.resolve(api));
    const writer = new JsforceSalesforceWriter(connect, { appEnvironment: 'test' });
    for (const fields of [{ Amount: '1' }, { Name: 'x' }, {}]) {
      expect(await writer.updateOpportunity(OPP, fields, { dedupeKey: 'k' })).toMatchObject({
        ok: false,
        retryable: false,
        code: 'FIELD_NOT_ALLOWED',
      });
    }
    expect(await writer.updateOpportunity("x' OR Id != '", { StageName: 'Quoting' }, { dedupeKey: 'k' }))
      .toMatchObject({ ok: false, code: 'INVALID_ID' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('never writes to a production instance from outside prod, even if the login URL said sandbox', async () => {
    const { api, save } = stub(PROD);
    const writer = new JsforceSalesforceWriter(() => Promise.resolve(api), { appEnvironment: 'test' });
    const result = await writer.updateOpportunity(OPP, { StageName: 'Quoting' }, { dedupeKey: 'k' });
    expect(result).toMatchObject({ ok: false, retryable: false, code: 'INSTANCE_REFUSED' });
    expect(save).not.toHaveBeenCalled();
    expect(await writer.getCurrentStage(OPP)).toMatchObject({ ok: false, code: 'INSTANCE_REFUSED' });
  });

  it('reports a refused save (not retryable) and a busy org (retryable)', async () => {
    const { api: refused } = stub(SANDBOX, {
      update: () =>
        Promise.resolve({
          success: false,
          errors: [{ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'A loss reason is required' }],
        }),
    });
    const w1 = new JsforceSalesforceWriter(() => Promise.resolve(refused), { appEnvironment: 'test' });
    expect(await w1.updateOpportunity(OPP, { StageName: 'Closed Lost' }, { dedupeKey: 'k' })).toEqual({
      ok: false,
      retryable: false,
      code: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
      message: 'A loss reason is required',
    });
    const { api: busy } = stub(SANDBOX, {
      update: () => Promise.reject(Object.assign(new Error('x'), { errorCode: 'SERVER_UNAVAILABLE' })),
    });
    const w2 = new JsforceSalesforceWriter(() => Promise.resolve(busy), { appEnvironment: 'test' });
    expect(await w2.updateOpportunity(OPP, { StageName: 'Closed Lost' }, { dedupeKey: 'k' })).toMatchObject({
      ok: false,
      retryable: true,
      code: 'SERVER_UNAVAILABLE',
    });
  });

  it('an opportunity the write user cannot see is a NOT_FOUND, not a null stage', async () => {
    const { api } = stub(SANDBOX, {
      stageOf: () => Promise.resolve({ found: false, stage: null }),
    });
    const writer = new JsforceSalesforceWriter(() => Promise.resolve(api), { appEnvironment: 'test' });
    expect(await writer.getCurrentStage(OPP)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('FakeSalesforceWriter', () => {
  it('records calls, keeps the stage, and injects failures and a timeout that still reaches it', async () => {
    const fake = new FakeSalesforceWriter();
    fake.failNext({ kind: 'error', retryable: true }, { kind: 'timeout' });
    expect(await fake.updateOpportunity(OPP, { StageName: 'Closed Lost' }, { dedupeKey: 'a' })).toMatchObject({
      ok: false,
      retryable: true,
    });
    expect(fake.stageOf(OPP)).toBeUndefined();
    expect(await fake.updateOpportunity(OPP, { StageName: 'Closed Lost' }, { dedupeKey: 'a' })).toMatchObject({
      ok: false,
      code: 'TIMEOUT',
    });
    expect(fake.stageOf(OPP)).toBe('Closed Lost');
    expect(await fake.getCurrentStage(OPP)).toEqual({ ok: true, stage: 'Closed Lost' });
    expect(fake.calls).toHaveLength(2);
    expect(await fake.updateOpportunity(OPP, { Amount: '1' }, { dedupeKey: 'b' })).toMatchObject({
      code: 'FIELD_NOT_ALLOWED',
    });
  });
});
