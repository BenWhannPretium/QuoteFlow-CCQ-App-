import type { Actor } from '@ccq/domain';
import {
  FakePricingReader,
  PRICING_COLUMNS,
  syntheticPricingFixture,
  type PricingLogger,
} from '@ccq/integrations';
import { describe, expect, it } from 'vitest';

import { PricingAppService, PricingUsage } from './pricing-app';
import { ServiceProblem } from './problem';

const C = PRICING_COLUMNS;
const fixture = syntheticPricingFixture();
const erfRow = fixture.erf[0]!;
const ERF = String(erfRow[C.erf.erfNumber.column]);
const CUSTOMER = String(erfRow[C.erf.customerName.column]);

const pricing = { userId: 'u1', roles: ['Pricing'], scope: { type: 'all' } } as unknown as Actor;

function setup(now = () => new Date('2026-11-04T15:10:00Z')) {
  const lines: unknown[] = [];
  const logger: PricingLogger = {
    info: (o, m) => lines.push([o, m]),
    warn: (o, m) => lines.push([o, m]),
    error: (o, m) => lines.push([o, m]),
  };
  const reader = new FakePricingReader(syntheticPricingFixture());
  const usage = new PricingUsage({ now, logger }); // no database: counts stay pending
  const service = new PricingAppService({ reader, usage, logger, now });
  return { lines, reader, usage, service };
}

describe('PricingAppService', () => {
  it('never logs row contents, values or error messages (codes only)', async () => {
    const { lines, reader, service } = setup();
    reader.failWith = Object.assign(new Error(`Conversion failed for '${CUSTOMER}' ${ERF}`), {
      code: 'EREQUEST',
    });
    await expect(service.erf(pricing, ERF)).rejects.toBeInstanceOf(ServiceProblem);
    await expect(
      service.searchErfs(pricing, { customer: CUSTOMER, limit: 10 }),
    ).rejects.toMatchObject({ status: 503, code: 'pricing_app_unavailable' });
    await expect(service.bpr(pricing, 'BPR-410001')).rejects.toMatchObject({ status: 503 });
    reader.failWith = null;
    await service.erf(pricing, ERF);

    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(CUSTOMER);
    expect(logged).not.toContain(ERF);
    expect(logged).not.toContain('Conversion failed');
    expect(lines).toEqual([
      [{ op: 'erf', code: 'EREQUEST' }, 'pricing app read failed'],
      [{ op: 'searchErfs', code: 'EREQUEST' }, 'pricing app read failed'],
      [{ op: 'bpr', code: 'EREQUEST' }, 'pricing app read failed'],
    ]);
  });

  it('a 503 says to enter references manually and carries no data', async () => {
    const { reader, service } = setup();
    reader.failWith = Object.assign(new Error(CUSTOMER), { code: 'ESOCKET' });
    const err = (await service.erf(pricing, ERF).catch((e: unknown) => e)) as ServiceProblem;
    expect(err.status).toBe(503);
    expect(err.message).toBe(
      'Pricing app unavailable (ESOCKET). Enter ERF/BPR references manually.',
    );
  });

  it('counts requests, reader calls, cache hits, rows and failures by hour', async () => {
    let now = new Date('2026-11-04T15:10:00Z');
    const { reader, usage, service } = setup(() => now);
    await service.erf(pricing, ERF); // getErf + findBprsForErf
    await service.erf(pricing, ERF); // cached
    reader.failWith = new Error('x');
    await service.bpr(pricing, 'BPR-1').catch(() => {});
    expect(usage.pending()).toMatchObject({ requests: 3, calls: 3, cacheHits: 2, failed: 1 });
    expect(usage.pending().rows).toBeGreaterThanOrEqual(1);
    now = new Date('2026-11-04T16:01:00Z');
    expect(PricingUsage.hourOf(now).toISOString()).toBe('2026-11-04T16:00:00.000Z');
  });
});
