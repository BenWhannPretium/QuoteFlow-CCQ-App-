import { describe, expect, it } from 'vitest';

import { REDACTED, redactSecrets } from './audit';

describe('redactSecrets', () => {
  it('replaces secret-looking keys at any depth and keeps everything else', () => {
    const when = new Date('2026-10-27T15:00:00Z');
    expect(
      redactSecrets({
        field: 'ship_to',
        accessToken: 'eyJ...',
        nested: {
          Authorization: 'Bearer x',
          list: [{ refresh_token: 'r', ok: 1 }],
          private_key: 'k',
        },
        at: when,
        n: null,
      }),
    ).toEqual({
      field: 'ship_to',
      accessToken: REDACTED,
      nested: {
        Authorization: REDACTED,
        list: [{ refresh_token: REDACTED, ok: 1 }],
        private_key: REDACTED,
      },
      at: '2026-10-27T15:00:00.000Z',
      n: null,
    });
  });

  it('passes primitives through and caps runaway depth', () => {
    expect(redactSecrets('x')).toBe('x');
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 30; i++) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    expect(JSON.stringify(redactSecrets(root))).toContain(REDACTED);
  });
});
