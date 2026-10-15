import { describe, expect, it } from 'vitest';

import {
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from './theme';

const memory = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('theme preference storage', () => {
  it('round-trips light and dark; system clears the key', () => {
    const s = memory();
    expect(writeThemePreference(s, 'dark')).toBe(true);
    expect(readThemePreference(s)).toBe('dark');
    writeThemePreference(s, 'system');
    expect(s.map.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readThemePreference(s)).toBe('system');
  });

  it('ignores junk values', () => {
    const s = memory();
    s.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readThemePreference(s)).toBe('system');
  });

  it('never throws when storage is blocked or missing', () => {
    expect(readThemePreference(blocked)).toBe('system');
    expect(writeThemePreference(blocked, 'dark')).toBe(false);
    expect(readThemePreference(undefined)).toBe('system');
    expect(writeThemePreference(undefined, 'light')).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('follows the system unless pinned', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
