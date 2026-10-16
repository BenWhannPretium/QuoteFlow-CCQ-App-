import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activePipelineFilterCount,
  clearPipelineFilters,
  filterValueFromSearch,
  parsePipelineSearch,
  pipelineApiQuery,
  searchWithFilterValue,
  sortDirFor,
} from './pipeline-search';
import { deleteView, listSavedViews, readColumns, saveView, writeColumns } from './saved-views';

describe('pipeline URL search', () => {
  it('keeps valid keys, normalises lists and drops anything malformed', () => {
    expect(
      parsePipelineSearch({
        q: '  jar ',
        stage: ['QUOTING', 'FINAL_REVIEW', 'QUOTING'],
        tier: 'HIGH, CRITICAL,',
        status: 'nope',
        agedOverDays: '7',
        closeDateFrom: '2026-11-01',
        closeDateTo: 'tomorrow',
        hasWarnings: 'true',
        sfMismatch: false,
        sort: 'score',
        dir: 'sideways',
        page: '0',
        extra: 'x',
      }),
    ).toEqual({
      q: 'jar',
      stage: 'QUOTING,FINAL_REVIEW',
      tier: 'HIGH,CRITICAL',
      agedOverDays: 7,
      closeDateFrom: '2026-11-01',
      hasWarnings: true,
      sfMismatch: false,
      sort: 'score',
    });
  });

  it('round-trips the Filters popover value, resetting the page', () => {
    const s = parsePipelineSearch({ stage: 'QUOTING', status: 'open', page: 3, q: 'x' });
    const value = filterValueFromSearch(s);
    expect(value).toEqual({ stage: ['QUOTING'], status: ['open'] });
    const next = searchWithFilterValue(s, { ...value, status: ['open', 'closed'], kam: ['me'] });
    expect(next).toEqual({ q: 'x', stage: 'QUOTING', status: 'closed', kam: 'me' });
  });

  it('counts and clears filters (search text and sort survive)', () => {
    const s = parsePipelineSearch({
      q: 'x',
      stage: 'A,B',
      agedOverDays: 3,
      hasWarnings: 'false',
      sort: 'amount',
    });
    expect(activePipelineFilterCount(s)).toBe(4);
    expect(clearPipelineFilters(s)).toEqual({ q: 'x', sort: 'amount' });
  });

  it('builds the API query and the sort defaults', () => {
    const s = parsePipelineSearch({ stage: 'A,B', hasWarnings: 'true' });
    expect(pipelineApiQuery(s, { sort: 'score', pageSize: 50, includeClosed: undefined })).toEqual({
      stage: 'A,B',
      hasWarnings: 'true',
      sort: 'score',
      pageSize: '50',
    });
    expect(sortDirFor({}, 'updated')).toEqual(['desc', 'updated']);
    expect(sortDirFor({ sort: 'closeDate' }, 'updated')).toEqual(['asc', 'closeDate']);
    expect(sortDirFor({ sort: 'score', dir: 'asc' }, 'updated')).toEqual(['asc', 'score']);
  });
});

describe('saved views (localStorage, per user and view)', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('saves, replaces by name, lists newest first and deletes', () => {
    vi.stubGlobal('window', { localStorage: storage });
    expect(saveView('u1', 'quotes', 'Aged', { agedOverDays: 14 })).toBe(true);
    expect(saveView('u1', 'quotes', 'Mine', { kam: 'me' })).toBe(true);
    expect(saveView('u1', 'quotes', 'Aged', { agedOverDays: 30 })).toBe(true);
    expect(saveView('u1', 'quotes', '   ', {})).toBe(false);
    expect(listSavedViews('u1', 'quotes').map((v) => [v.name, v.search])).toEqual([
      ['Aged', { agedOverDays: 30 }],
      ['Mine', { kam: 'me' }],
    ]);
    expect(listSavedViews('u2', 'quotes')).toEqual([]);
    expect(listSavedViews('u1', 'board')).toEqual([]);
    deleteView('u1', 'quotes', 'Mine');
    expect(listSavedViews('u1', 'quotes').map((v) => v.name)).toEqual(['Aged']);
  });

  it('survives blocked or corrupt storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
      },
    });
    expect(listSavedViews('u1', 'quotes')).toEqual([]);
    expect(saveView('u1', 'quotes', 'x', {})).toBe(false);
    expect(readColumns('u1')).toBeNull();
    expect(() => writeColumns('u1', ['quoteNumber'])).not.toThrow();
    vi.stubGlobal('window', { localStorage: { ...storage, getItem: () => '{not json' } });
    expect(listSavedViews('u1', 'quotes')).toEqual([]);
  });

  it('remembers the column choice', () => {
    vi.stubGlobal('window', { localStorage: storage });
    writeColumns('u1', ['quoteNumber', 'amount']);
    expect(readColumns('u1')).toEqual(['quoteNumber', 'amount']);
  });
});
