import { describe, expect, it } from 'vitest';

import { REDACTED, redactSensitive } from './logger';

describe('redactSensitive', () => {
  it('masks price and token keys at any depth', () => {
    const out = redactSensitive({
      quote: { unitPrice: 1.23, priceApproved: true, lines: [{ netPrice: 4 }] },
      auth: { accessToken: 'abc', refresh_token: 'def' },
      keep: 'me',
    });
    expect(out).toEqual({
      quote: { unitPrice: REDACTED, priceApproved: REDACTED, lines: [{ netPrice: REDACTED }] },
      auth: { accessToken: REDACTED, refresh_token: REDACTED },
      keep: 'me',
    });
  });

  it('leaves primitives untouched', () => {
    expect(redactSensitive('price')).toBe('price');
  });
});
