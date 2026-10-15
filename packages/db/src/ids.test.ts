import { describe, expect, it } from 'vitest';

import { isUuid, uuidv7 } from './ids';

describe('uuidv7', () => {
  it('is a valid version-7 RFC 9562 UUID', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('encodes the timestamp, so ids sort by creation time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(1_700_000_000_000);
  });

  it('is deterministic for an injected random source', () => {
    const zeros = (n: number) => new Uint8Array(n);
    expect(uuidv7(0, zeros)).toBe('00000000-0000-7000-8000-000000000000');
  });
});
