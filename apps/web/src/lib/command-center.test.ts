import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  analyticsRedirectSearch,
  analyticsSearchOf,
  commandCenterTitle,
  parseCommandCenterSearch,
  readCommandCenterView,
  rememberCommandCenterView,
  resolveCommandCenterView,
} from './command-center';

/** FB-18 (W13-29): the Command Center's two views and the old /analytics address. */
describe('the Command Center URL', () => {
  it('keeps the role and the view, and the analytics filters only in the Analytics view', () => {
    expect(parseCommandCenterSearch({})).toEqual({});
    expect(parseCommandCenterSearch({ as: 'SalesLeader' })).toEqual({ as: 'SalesLeader' });
    const full = { as: 'SalesLeader', view: 'analytics', market: 'FOOD' };
    expect(parseCommandCenterSearch(full)).toEqual(full);
    expect(parseCommandCenterSearch({ as: 'Approver', view: 'work' })).toEqual({
      as: 'Approver',
      view: 'work',
    });
    // A filter without the Analytics view means nothing on My work.
    expect(parseCommandCenterSearch({ market: 'FOOD', from: '2026-10-01' })).toEqual({});
    expect(parseCommandCenterSearch({ view: 'work', market: 'FOOD' })).toEqual({ view: 'work' });
  });

  it('drops anything malformed instead of failing', () => {
    expect(parseCommandCenterSearch({ as: '', view: 'charts', junk: 1 })).toEqual({});
    expect(parseCommandCenterSearch({ as: 42, view: ['analytics'] })).toEqual({});
    const bad = { view: 'analytics', from: 'yesterday', region: 7 };
    expect(parseCommandCenterSearch(bad)).toEqual({ view: 'analytics' });
  });

  it('hands the Analytics view its filters without the role or the view', () => {
    const search = parseCommandCenterSearch({
      as: 'EngLead',
      view: 'analytics',
      from: '2026-08-01',
      to: '2026-10-19',
      kam: 'me',
    });
    expect(analyticsSearchOf(search)).toEqual({ from: '2026-08-01', to: '2026-10-19', kam: 'me' });
    expect(analyticsSearchOf({ as: 'KAM' })).toEqual({});
  });
});

describe('the old /analytics address', () => {
  it('redirects to the Analytics view', () => {
    expect(analyticsRedirectSearch({})).toEqual({ view: 'analytics' });
  });

  it('carries every filter the link had, cleaned the same way', () => {
    expect(
      analyticsRedirectSearch({
        from: '2026-08-01',
        to: '2026-10-19',
        market: 'FOOD, BEVERAGE,FOOD',
        productFamily: 'BOTTLE',
        kam: '019a0000-0000-7000-8000-000000000001',
        region: 'East',
      }),
    ).toEqual({
      view: 'analytics',
      from: '2026-08-01',
      to: '2026-10-19',
      market: 'FOOD,BEVERAGE',
      productFamily: 'BOTTLE',
      kam: '019a0000-0000-7000-8000-000000000001',
      region: 'East',
    });
  });

  it('ends up as a URL the Command Center reads back unchanged', () => {
    const target = analyticsRedirectSearch({ market: 'FOOD', from: 'nope', view: 'work', as: 'x' });
    expect(target).toEqual({ view: 'analytics', market: 'FOOD' });
    expect(parseCommandCenterSearch({ ...target })).toEqual(target);
  });
});

describe('which view opens', () => {
  it('the URL wins; otherwise the view the user last chose; My work the first time', () => {
    expect(resolveCommandCenterView({}, null, true)).toBe('work');
    expect(resolveCommandCenterView({}, 'work', true)).toBe('work');
    expect(resolveCommandCenterView({}, 'analytics', true)).toBe('analytics');
    expect(resolveCommandCenterView({ view: 'analytics' }, 'work', true)).toBe('analytics');
    expect(resolveCommandCenterView({ view: 'work' }, 'analytics', true)).toBe('work');
  });

  it('never opens a remembered Analytics view for a user who may not read analytics', () => {
    expect(resolveCommandCenterView({}, 'analytics', false)).toBe('work');
    // Asked for by the URL, it is still "analytics": the page shows the 403 page, as /analytics did.
    expect(resolveCommandCenterView({ view: 'analytics' }, null, false)).toBe('analytics');
  });

  it('names the tab after the page and the Command Center', () => {
    expect(commandCenterTitle('My quotes')).toBe('My quotes · Command Center');
    expect(commandCenterTitle('Analytics')).toBe('Analytics · Command Center');
    expect(commandCenterTitle(null)).toBe('Command Center');
  });
});

describe('the remembered view (localStorage, per user)', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('remembers the last view per user', () => {
    vi.stubGlobal('window', { localStorage: storage });
    expect(readCommandCenterView('u1')).toBeNull();
    rememberCommandCenterView('u1', 'analytics');
    expect(readCommandCenterView('u1')).toBe('analytics');
    expect(store.get('ccq.commandCenterView.u1')).toBe('analytics');
    expect(readCommandCenterView('u2')).toBeNull();
    rememberCommandCenterView('u1', 'work');
    expect(readCommandCenterView('u1')).toBe('work');
  });

  it('ignores a stored value it did not write', () => {
    vi.stubGlobal('window', { localStorage: { ...storage, getItem: () => 'charts' } });
    expect(readCommandCenterView('u4')).toBeNull();
  });

  it('survives blocked storage: the choice lasts for this visit', () => {
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
    expect(readCommandCenterView('u5')).toBeNull();
    expect(() => rememberCommandCenterView('u5', 'analytics')).not.toThrow();
    expect(readCommandCenterView('u5')).toBe('analytics');
  });
});
