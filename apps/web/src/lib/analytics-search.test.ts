import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  analyticsApiQuery,
  drillDown,
  lastDays,
  parseAnalyticsSearch,
} from './analytics-search';

describe('parseAnalyticsSearch', () => {
  it('keeps valid days and dimension values', () => {
    expect(
      parseAnalyticsSearch({
        from: '2026-08-01',
        to: '2026-10-19',
        market: 'FOOD',
        productFamily: 'BOTTLE',
        kam: '019a0000-0000-7000-8000-000000000001',
        region: 'East',
      }),
    ).toEqual({
      from: '2026-08-01',
      to: '2026-10-19',
      market: 'FOOD',
      productFamily: 'BOTTLE',
      kam: '019a0000-0000-7000-8000-000000000001',
      region: 'East',
    });
  });

  it('drops anything malformed instead of failing', () => {
    expect(
      parseAnalyticsSearch({
        from: 'yesterday',
        to: '2026-13-99x',
        market: '',
        region: 42,
        junk: 'x',
      }),
    ).toEqual({});
  });

  it('de-duplicates and trims comma lists, and takes arrays', () => {
    expect(parseAnalyticsSearch({ market: ' FOOD, PET ,FOOD' })).toEqual({ market: 'FOOD,PET' });
    expect(parseAnalyticsSearch({ market: ['FOOD', 'PET'] })).toEqual({ market: 'FOOD,PET' });
  });
});

describe('analytics filters', () => {
  it('counts the dates as one filter and each dimension as one', () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ from: '2026-01-01', to: '2026-02-01' })).toBe(1);
    expect(activeFilterCount({ from: '2026-01-01', market: 'FOOD', kam: 'x' })).toBe(3);
  });

  it('passes the filters to the API as they are', () => {
    expect(analyticsApiQuery({ market: 'FOOD', from: '2026-01-01' })).toEqual({
      market: 'FOOD',
      from: '2026-01-01',
    });
  });

  it('lastDays includes today: 30 days ending Oct 19 starts Sep 20', () => {
    expect(lastDays(30, '2026-10-19')).toEqual({ from: '2026-09-20', to: '2026-10-19' });
    expect(lastDays(1, '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-19' });
  });
});

describe('drillDown (the B-14 quote list URL)', () => {
  it('carries market, product family and KAM, plus the chart’s own slice', () => {
    expect(
      drillDown(
        { market: 'FOOD', productFamily: 'JAR', kam: 'u1', region: 'East', from: '2026-01-01' },
        { stage: 'QUOTING', status: 'open' },
      ),
    ).toEqual({
      market: 'FOOD',
      productFamily: 'JAR',
      kam: 'u1',
      stage: 'QUOTING',
      status: 'open',
    });
  });

  it('does not carry the region or the dates: the list has no such filters', () => {
    const out = drillDown({ region: 'East', from: '2026-01-01', to: '2026-02-01' });
    expect(out).toEqual({});
  });

  it('lets the chart’s own slice win over a filter of the same key', () => {
    expect(drillDown({ market: 'FOOD' }, { market: 'PET' })).toEqual({ market: 'PET' });
  });
});
