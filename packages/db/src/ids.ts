import { randomBytes } from 'node:crypto';

/** Fills a buffer with random bytes. Injected so the synthetic generator can be deterministic. */
export type RandomSource = (size: number) => Uint8Array;

/**
 * RFC 9562 UUID version 7: 48-bit Unix-ms timestamp, then random bits. Sorts by creation time,
 * which keeps B-tree inserts local. Primary keys are generated here, in app code, never by the DB.
 */
export function uuidv7(ms: number = Date.now(), random: RandomSource = randomBytes): string {
  const bytes = new Uint8Array(16);
  bytes.set(random(10), 6);
  let t = Math.trunc(ms);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8]! & 0x3f); // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);
