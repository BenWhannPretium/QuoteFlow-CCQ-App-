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

  // FB-27 (N17-17): the Plant filter is a multi-value key like the others, and reaches the API query.
  it('carries the plant filter through the URL, the popover value and the API query', () => {
    const s = parsePipelineSearch({ plant: 'AURORA,CARROLLTON,AURORA', stage: 'QUOTING' });
    expect(s.plant).toBe('AURORA,CARROLLTON');
    expect(filterValueFromSearch(s).plant).toEqual(['AURORA', 'CARROLLTON']);
    expect(activePipelineFilterCount(s)).toBe(3);
    expect(pipelineApiQuery(s).plant).toBe('AURORA,CARROLLTON');
    expect(searchWithFilterValue(s, { plant: ['ST_LOUIS'] }).plant).toBe('ST_LOUIS');
    expect(clearPipelineFilters(s).plant).toBeUndefined();
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

  // FB-27 (N17-17): a view keeps the columns and their order; one saved before that keeps the current
  // columns (no `columns` on it).
  it('saves the columns in their order and gives them back', () => {
    vi.stubGlobal('window', { localStorage: storage });
    const cols = ['plant', 'quoteNumber', 'stage'];
    expect(saveView('u1', 'quotes', 'Faron', { plant: 'AURORA' }, { columns: cols })).toBe(true);
    expect(listSavedViews('u1', 'quotes')[0]).toMatchObject({
      name: 'Faron',
      search: { plant: 'AURORA' },
      columns: ['plant', 'quoteNumber', 'stage'],
    });
    // Saving again under the name replaces the columns too.
    saveView('u1', 'quotes', 'Faron', {}, { columns: ['stage'] });
    expect(listSavedViews('u1', 'quotes')[0]!.columns).toEqual(['stage']);
  });

  it('an older view without columns still loads and has none', () => {
    vi.stubGlobal('window', { localStorage: storage });
    store.set(
      'ccq.savedViews.u1.quotes',
      JSON.stringify([
        { name: 'Old', search: { stage: 'QUOTING' }, savedAt: '2026-10-01T00:00:00Z' },
      ]),
    );
    const [view] = listSavedViews('u1', 'quotes');
    expect(view).toEqual({
      name: 'Old',
      search: { stage: 'QUOTING' },
      savedAt: '2026-10-01T00:00:00Z',
    });
    expect(view!.columns).toBeUndefined();
    // Columns that are not a list of strings are dropped, not trusted.
    store.set(
      'ccq.savedViews.u1.quotes',
      JSON.stringify([{ name: 'Odd', search: {}, columns: [1, 2], savedAt: 'x' }]),
    );
    expect(listSavedViews('u1', 'quotes')[0]!.columns).toBeUndefined();
  });

  it('a view saved without columns (the board) stays without', () => {
    vi.stubGlobal('window', { localStorage: storage });
    saveView('u1', 'board', 'Mine', { kam: 'me' });
    expect(listSavedViews('u1', 'board')[0]!.columns).toBeUndefined();
  });

  it('remembers the column choice', () => {
    vi.stubGlobal('window', { localStorage: storage });
    writeColumns('u1', ['quoteNumber', 'amount']);
    expect(readColumns('u1')).toEqual(['quoteNumber', 'amount']);
  });
});
