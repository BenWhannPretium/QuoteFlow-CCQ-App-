import type { Readable } from 'node:stream';

import { FileStoreError } from './filestore';

/**
 * Re-chunk a byte stream into pieces of exactly `chunkSize` bytes (the last may be shorter) while
 * holding the stream to exactly `size` bytes. Memory stays around one chunk: pieces are concatenated
 * only up to the chunk boundary.
 */
export async function* exactChunks(
  stream: Readable,
  size: number,
  chunkSize: number,
): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let total = 0;
  for await (const piece of stream as AsyncIterable<Buffer | string>) {
    let buf = typeof piece === 'string' ? Buffer.from(piece) : piece;
    total += buf.length;
    if (total > size) {
      stream.destroy();
      throw new FileStoreError('TOO_LARGE', `The file is larger than the declared ${size} bytes`);
    }
    while (pendingBytes + buf.length >= chunkSize) {
      const take = chunkSize - pendingBytes;
      pending.push(buf.subarray(0, take));
      yield Buffer.concat(pending, chunkSize);
      buf = buf.subarray(take);
      pending = [];
      pendingBytes = 0;
    }
    if (buf.length > 0) {
      pending.push(buf);
      pendingBytes += buf.length;
    }
  }
  if (total !== size) {
    throw new FileStoreError(
      'SIZE_MISMATCH',
      `The file ended after ${total} of the declared ${size} bytes`,
    );
  }
  if (pendingBytes > 0) yield Buffer.concat(pending, pendingBytes);
}
