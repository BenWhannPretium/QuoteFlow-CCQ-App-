import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { FileStoreError, type FileStore } from './filestore';

export interface ContractSubject {
  store: FileStore;
  /** The stored bytes, read back through the store's backing (disk, mock drive, memory). */
  readBack: (itemId: string) => Promise<Buffer>;
}

/** A stream that delivers `buf` in uneven pieces (as a socket would). */
export function streamOf(buf: Buffer, piece = 7_001): Readable {
  return Readable.from(
    (function* () {
      for (let i = 0; i < buf.length; i += piece) yield buf.subarray(i, i + piece);
    })(),
  );
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err instanceof FileStoreError ? err.code : `not a FileStoreError: ${String(err)}`;
  }
}

/**
 * The FileStore contract (B-16). Every implementation runs it: LocalFileStore on disk,
 * SharePointFileStore against the mock Graph drive, BlobFileStore against the memory container. So
 * switching FILESTORE_MODE changes where bytes live, not how the API behaves.
 */
export function describeFileStoreContract(
  label: string,
  make: () => Promise<ContractSubject>,
  opts: { root?: string; missingId?: string } = {},
) {
  const root = opts.root ?? 'CCQ';
  const missingId = opts.missingId ?? `${root}/nothing-here/missing.pdf`;
  describe(`FileStore contract: ${label}`, () => {
    const folder = `${root}/CCQ-2026-00001`;

    it('uploads, lists, gets and reads back the exact bytes (several chunks)', async () => {
      const { store, readBack } = await make();
      const bytes = randomBytes(1_400_000);
      const file = await store.upload(
        `${folder}/drawing.pdf`,
        streamOf(bytes),
        bytes.length,
        'application/pdf',
      );
      expect(file).toMatchObject({ name: 'drawing.pdf', folder, size: bytes.length });
      expect((await store.list(folder)).map((f) => f.itemId)).toEqual([file.itemId]);
      expect(await store.get(file.itemId)).toMatchObject({
        name: 'drawing.pdf',
        size: bytes.length,
      });
      expect((await readBack(file.itemId)).equals(bytes)).toBe(true);
    });

    it('creates folders idempotently, nested, and lists only files', async () => {
      const { store } = await make();
      await store.ensureFolder(`${root}/_drafts/abc`);
      await store.ensureFolder(`${root}/_drafts/abc`);
      await store.upload(`${root}/_drafts/abc/a.png`, streamOf(Buffer.from('x')), 1, 'image/png');
      expect((await store.list(`${root}/_drafts`)).map((f) => f.name)).toEqual([]);
      expect((await store.list(`${root}/_drafts/abc`)).map((f) => f.name)).toEqual(['a.png']);
    });

    it('never overwrites: a taken name is renamed', async () => {
      const { store, readBack } = await make();
      const a = await store.upload(`${folder}/spec.xlsx`, streamOf(Buffer.from('first')), 5, 'x');
      const b = await store.upload(`${folder}/spec.xlsx`, streamOf(Buffer.from('second')), 6, 'x');
      expect(b.itemId).not.toBe(a.itemId);
      expect(b.name).not.toBe('spec.xlsx');
      expect(b.name.endsWith('.xlsx')).toBe(true);
      expect((await readBack(a.itemId)).toString()).toBe('first');
      expect((await readBack(b.itemId)).toString()).toBe('second');
      expect(await store.list(folder)).toHaveLength(2);
    });

    it('holds the stream to its declared size and keeps nothing on a mismatch', async () => {
      const { store } = await make();
      expect(
        await code(store.upload(`${folder}/short.pdf`, streamOf(Buffer.alloc(10)), 11, 'x')),
      ).toBe('SIZE_MISMATCH');
      expect(
        await code(store.upload(`${folder}/long.pdf`, streamOf(Buffer.alloc(900_000)), 10, 'x')),
      ).toBe('TOO_LARGE');
      expect(await store.list(folder)).toEqual([]);
    });

    it('a missing folder lists as empty; a missing item is null / NOT_FOUND', async () => {
      const { store } = await make();
      expect(await store.list(`${root}/nothing-here`)).toEqual([]);
      expect(await store.get(missingId)).toBeNull();
      expect(await code(store.move(missingId, `${root}/elsewhere`))).toBe('NOT_FOUND');
      expect(await code(store.delete(missingId, `${root}/_removed`))).toBe('NOT_FOUND');
    });

    it('moves a file (draft → quote) with its bytes', async () => {
      const { store, readBack } = await make();
      const draft = await store.upload(
        `${root}/_drafts/d1/photo.jpg`,
        streamOf(Buffer.from('jpeg!')),
        5,
        'image/jpeg',
      );
      const moved = await store.move(draft.itemId, folder);
      expect(moved).toMatchObject({ name: 'photo.jpg', folder, size: 5 });
      expect(await store.list(`${root}/_drafts/d1`)).toEqual([]);
      expect((await store.list(folder)).map((f) => f.itemId)).toEqual([moved.itemId]);
      expect((await readBack(moved.itemId)).toString()).toBe('jpeg!');
    });

    it('a move into a folder that has the name renames instead of overwriting', async () => {
      const { store } = await make();
      await store.upload(`${folder}/a.pdf`, streamOf(Buffer.from('1')), 1, 'x');
      const other = await store.upload(
        `${root}/_drafts/d2/a.pdf`,
        streamOf(Buffer.from('2')),
        1,
        'x',
      );
      const moved = await store.move(other.itemId, folder);
      expect(moved.name).not.toBe('a.pdf');
      expect(await store.list(folder)).toHaveLength(2);
    });

    it('soft-deletes into removed/<folder name>/', async () => {
      const { store, readBack } = await make();
      const f = await store.upload(`${folder}/old.pdf`, streamOf(Buffer.from('keep me')), 7, 'x');
      const removed = await store.delete(f.itemId, `${root}/_removed`);
      expect(removed.folder).toBe(`${root}/_removed/CCQ-2026-00001`);
      expect(await store.list(folder)).toEqual([]);
      expect(await store.get(removed.itemId)).toMatchObject({ folder: removed.folder });
      expect((await readBack(removed.itemId)).toString()).toBe('keep me');
    });

    it('gives a short-lived download link', async () => {
      const { store } = await make();
      const f = await store.upload(`${folder}/a.pdf`, streamOf(Buffer.from('1')), 1, 'x');
      const before = Date.now();
      const link = await store.getDownloadUrl(f.itemId, {
        fileName: 'Drawing A.pdf',
        mime: 'application/pdf',
      });
      expect(link.url).toMatch(/^(https:\/\/|\/api\/)/);
      expect(link.expiresAt.getTime()).toBeGreaterThan(before);
      expect(link.expiresAt.getTime()).toBeLessThanOrEqual(before + 60 * 60_000);
    });

    it('refuses unsafe paths', async () => {
      const { store } = await make();
      for (const bad of [
        '../etc/passwd',
        `${root}/../x/a.pdf`,
        'a.pdf',
        `${root}//a.pdf`,
        `${root}/a:b.pdf`,
      ]) {
        expect(await code(store.upload(bad, streamOf(Buffer.from('1')), 1, 'x'))).toBe(
          'INVALID_PATH',
        );
      }
    });
  });
}
