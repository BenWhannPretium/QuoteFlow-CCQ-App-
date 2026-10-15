import { describe, expect, it } from 'vitest';

import { uuidv7 } from './ids';
import { contextSettings } from './withRequestContext';

describe('contextSettings', () => {
  const userId = uuidv7();

  it('maps the actor onto the app.* settings RLS reads', () => {
    expect(
      contextSettings({
        userId,
        roles: ['KAM', 'SalesLeader'],
        scope: { type: 'region', values: ['East', 'West'] },
      }),
    ).toEqual({
      'app.user_id': userId,
      'app.roles': 'KAM,SalesLeader',
      'app.scope_type': 'region',
      'app.scope_values': 'East,West',
    });
    expect(
      contextSettings({ userId, roles: ['Admin'], scope: { type: 'all' } })['app.scope_values'],
    ).toBe('');
  });

  it('rejects anything that could confuse the csv settings', () => {
    expect(() => contextSettings({ userId: 'x', roles: ['KAM'], scope: { type: 'all' } })).toThrow(
      /UUID/,
    );
    expect(() =>
      contextSettings({ userId, roles: ['CCQ.KAM' as never], scope: { type: 'all' } }),
    ).toThrow(/role/);
    expect(() =>
      contextSettings({ userId, roles: ['KAM'], scope: { type: 'region', values: ['a,b'] } }),
    ).toThrow(/commas/);
    expect(() =>
      contextSettings({ userId, roles: ['KAM'], scope: { type: 'account_list', values: [' '] } }),
    ).toThrow(/non-empty/);
  });
});
