import { describe, expect, it } from 'vitest';

import { clientIp, withoutPort } from './clientIp';

describe('withoutPort', () => {
  it.each([
    ['203.0.113.9:51234', '203.0.113.9'],
    ['203.0.113.9', '203.0.113.9'],
    ['[2001:db8::1]:51234', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
    ['::ffff:203.0.113.9', '::ffff:203.0.113.9'],
    ['127.0.0.1', '127.0.0.1'],
  ])('%s -> %s', (given, expected) => {
    expect(withoutPort(given)).toBe(expected);
  });

  it('leaves anything it does not recognise as it is', () => {
    expect(withoutPort('unknown')).toBe('unknown');
    expect(withoutPort('')).toBe('');
  });

  it('reads the address from a request', () => {
    expect(clientIp({ ip: '203.0.113.9:443' })).toBe('203.0.113.9');
  });
});
