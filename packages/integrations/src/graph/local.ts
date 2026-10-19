import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readdir, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { FileStoreError, type DownloadLink, type FileStore, type StoredFile } from './filestore';
import { folderName, normalizePath, numberedName, splitPath } from './paths';
import { exactChunks } from './stream';

const TMP = '.tmp';

export interface LocalFileStoreOptions {
  /** Root folder (`.data/files` by default in the API). */
  root: string;
  /**
   * Builds the short-lived link for a file (the API signs one for its own local-download route).
   * Without it, getDownloadUrl fails: a plain path on disk is not a URL.
   */
  downloadUrl?: (itemId: string, fileName: string, expiresAt: Date) => string;
  /** How long a link lasts. Default 5 minutes. */
  linkTtlMs?: number;
  now?: () => Date;
}

/**
 * Development and CI only (the API refuses `FILESTORE_MODE=local` in production): files under a local
 * folder, item id = the path relative to the root. Writes go to a temp file and are linked into place,
 * so a name is never overwritten and a failed upload leaves nothing behind.
 */
export class LocalFileStore implements FileStore {
  readonly kind = 'local' as const;
  readonly root: string;
  private readonly now: () => Date;

  constructor(private readonly opts: LocalFileStoreOptions) {
    this.root = resolve(opts.root);
    this.now = opts.now ?? (() => new Date());
  }

  /** Absolute path for a relative one, refusing anything that escapes the root. */
  private abs(rel: string): string {
    const p = resolve(this.root, normalizePath(rel));
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new FileStoreError('INVALID_PATH', 'Path escapes the store root');
    }
    return p;
  }

  private async stored(rel: string): Promise<StoredFile | null> {
    try {
      const s = await stat(this.abs(rel));
      if (!s.isFile()) return null;
      const { folder, name } = splitPath(rel);
      return { itemId: rel, name, folder, size: s.size, webUrl: null };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Link `from` (absolute) into `folder` under `name`, numbering the name if taken. */
  private async placeUnique(from: string, folder: string, name: string): Promise<string> {
    await this.ensureFolder(folder);
    for (let n = 0; n < 1000; n++) {
      const rel = `${normalizePath(folder)}/${numberedName(name, n)}`;
      try {
        await link(from, this.abs(rel));
        return rel;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new FileStoreError('FAILED', 'Too many files with this name');
  }

  async ensureFolder(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true });
  }

  async upload(path: string, stream: Readable, size: number, _mime: string): Promise<StoredFile> {
    const { folder, name } = splitPath(path);
    await mkdir(join(this.root, TMP), { recursive: true });
    const tmp = join(this.root, TMP, randomUUID());
    try {
      await pipeline(Readable.from(exactChunks(stream, size, 1024 * 1024)), createWriteStream(tmp));
      const rel = await this.placeUnique(tmp, folder, name);
      return (await this.stored(rel))!;
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async list(path: string): Promise<StoredFile[]> {
    let names: string[];
    try {
      names = (await readdir(this.abs(path), { withFileTypes: true }))
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = await Promise.all(names.map((n) => this.stored(`${normalizePath(path)}/${n}`)));
    return files.filter((f): f is StoredFile => f !== null);
  }

  get(itemId: string): Promise<StoredFile | null> {
    return this.stored(itemId);
  }

  /** The bytes (the API's signed local-download route). */
  async openRead(itemId: string): Promise<{ file: StoredFile; stream: Readable }> {
    const file = await this.stored(itemId);
    if (!file) throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    return { file, stream: createReadStream(this.abs(itemId)) };
  }

  async getDownloadUrl(itemId: string, opts: { fileName: string }): Promise<DownloadLink> {
    if (!(await this.stored(itemId)))
      throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    if (!this.opts.downloadUrl) throw new FileStoreError('FAILED', 'No download route configured');
    const expiresAt = new Date(this.now().getTime() + (this.opts.linkTtlMs ?? 5 * 60_000));
    return { url: this.opts.downloadUrl(itemId, opts.fileName, expiresAt), expiresAt };
  }

  async move(itemId: string, folder: string): Promise<StoredFile> {
    const from = this.abs(itemId);
    if (!(await this.stored(itemId)))
      throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    const { name } = splitPath(itemId);
    const rel = await this.placeUnique(from, folder, name);
    await unlink(from);
    await this.pruneEmpty(dirname(from));
    return (await this.stored(rel))!;
  }

  async delete(itemId: string, removedFolder: string): Promise<StoredFile> {
    const { folder } = splitPath(itemId);
    return this.move(itemId, `${normalizePath(removedFolder)}/${folderName(folder)}`);
  }

  /** Drop a folder emptied by a move (a submitted draft's folder), never the root. */
  private async pruneEmpty(dir: string): Promise<void> {
    if (dir === this.root || !dir.startsWith(this.root + sep)) return;
    // rmdir only removes an empty folder; a concurrent upload into it simply wins (ENOTEMPTY).
    await rmdir(dir).catch(() => undefined);
  }
}
