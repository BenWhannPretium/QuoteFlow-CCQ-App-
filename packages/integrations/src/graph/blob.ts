import { Readable } from 'node:stream';

import type { TokenCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type ContainerClient,
  type UserDelegationKey,
} from '@azure/storage-blob';

import { FileStoreError, type DownloadLink, type FileStore, type StoredFile } from './filestore';
import { folderName, normalizePath, numberedName, splitPath } from './paths';
import { exactChunks } from './stream';

/** The few container operations BlobFileStore needs (the Azure SDK, or an in-memory fake in tests). */
export interface BlobContainer {
  exists(name: string): Promise<boolean>;
  /** Fails with `CONFLICT` if the name exists (never overwrites). */
  upload(name: string, stream: Readable, contentType: string): Promise<void>;
  size(name: string): Promise<number | null>;
  /** Blobs directly under `prefix/` (not deeper). */
  list(prefix: string): Promise<{ name: string; size: number }[]>;
  copy(from: string, to: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** A read-only, HTTPS-only user-delegation SAS URL that downloads as `fileName`. */
  readUrl(name: string, expiresOn: Date, fileName: string, contentType: string): Promise<string>;
}

export class BlobConflictError extends Error {}

const statusOf = (err: unknown) =>
  typeof err === 'object' && err !== null && 'statusCode' in err
    ? (err as { statusCode?: number }).statusCode
    : undefined;

function mapAzureError(err: unknown): never {
  if (err instanceof FileStoreError || err instanceof BlobConflictError) throw err;
  const status = statusOf(err);
  if (status === 404) throw new FileStoreError('NOT_FOUND', 'Blob not found', 404);
  if (status === 409 || status === 412) throw new BlobConflictError('Blob exists');
  if (status === 401 || status === 403)
    throw new FileStoreError('FORBIDDEN', 'Blob access denied', status);
  if (status === 429 || status === 503)
    throw new FileStoreError('THROTTLED', 'Blob storage busy', status);
  throw new FileStoreError('UNAVAILABLE', 'Blob storage request failed', status);
}

/** `attachment; filename="…"; filename*=UTF-8''…` (RFC 6266), safe for any name. */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * The Azure SDK adapter: a **private** container, Entra auth (the App Service managed identity holds
 * Storage Blob Data Contributor on the container), downloads by user-delegation SAS (no account keys).
 */
export class AzureBlobContainer implements BlobContainer {
  private readonly service: BlobServiceClient;
  private readonly container: ContainerClient;
  private key: { value: UserDelegationKey; until: number } | null = null;

  constructor(opts: { accountUrl: string; container: string; credential: TokenCredential }) {
    this.service = new BlobServiceClient(opts.accountUrl, opts.credential);
    this.container = this.service.getContainerClient(opts.container);
  }

  async exists(name: string) {
    try {
      return await this.container.getBlobClient(name).exists();
    } catch (err) {
      return mapAzureError(err);
    }
  }

  async upload(name: string, stream: Readable, contentType: string) {
    try {
      // 4 MB buffers × 2 in flight: memory stays flat whatever the file size.
      await this.container.getBlockBlobClient(name).uploadStream(stream, 4 * 1024 * 1024, 2, {
        blobHTTPHeaders: { blobContentType: contentType },
        conditions: { ifNoneMatch: '*' },
      });
    } catch (err) {
      mapAzureError(err);
    }
  }

  async size(name: string) {
    try {
      return (await this.container.getBlobClient(name).getProperties()).contentLength ?? 0;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      return mapAzureError(err);
    }
  }

  async list(prefix: string) {
    const out: { name: string; size: number }[] = [];
    try {
      for await (const item of this.container.listBlobsByHierarchy('/', { prefix: `${prefix}/` })) {
        if (item.kind === 'blob')
          out.push({ name: item.name, size: item.properties.contentLength ?? 0 });
      }
    } catch (err) {
      mapAzureError(err);
    }
    return out;
  }

  async copy(from: string, to: string) {
    try {
      const source = await this.readUrl(
        from,
        new Date(Date.now() + 10 * 60_000),
        from,
        'application/octet-stream',
      );
      await this.container.getBlockBlobClient(to).syncCopyFromURL(source, {
        conditions: { ifNoneMatch: '*' },
      });
    } catch (err) {
      mapAzureError(err);
    }
  }

  async delete(name: string) {
    try {
      await this.container.getBlobClient(name).delete();
    } catch (err) {
      mapAzureError(err);
    }
  }

  private async delegationKey(expiresOn: Date): Promise<UserDelegationKey> {
    const now = Date.now();
    if (this.key && this.key.until > expiresOn.getTime()) return this.key.value;
    const until = now + 6 * 3_600_000;
    const value = await this.service.getUserDelegationKey(
      new Date(now - 5 * 60_000),
      new Date(until),
    );
    this.key = { value, until };
    return value;
  }

  async readUrl(name: string, expiresOn: Date, fileName: string, contentType: string) {
    try {
      const sas = generateBlobSASQueryParameters(
        {
          containerName: this.container.containerName,
          blobName: name,
          permissions: BlobSASPermissions.parse('r'),
          startsOn: new Date(Date.now() - 5 * 60_000),
          expiresOn,
          protocol: SASProtocol.Https,
          contentDisposition: contentDisposition(fileName),
          contentType,
        },
        await this.delegationKey(expiresOn),
        this.service.accountName,
      );
      return `${this.container.getBlobClient(name).url}?${sas.toString()}`;
    } catch (err) {
      return mapAzureError(err);
    }
  }
}

export interface BlobFileStoreOptions {
  /** How long a download link lasts. Default 5 minutes. */
  linkTtlMs?: number;
  now?: () => Date;
}

/**
 * The fallback store (D-SP: if SharePoint access is late or withdrawn). Same folders as SharePoint,
 * as blob name prefixes; item id = blob name, so a move returns a new id. Moves are copy + delete.
 */
export class BlobFileStore implements FileStore {
  readonly kind = 'blob' as const;
  private readonly now: () => Date;

  constructor(
    private readonly container: BlobContainer,
    private readonly opts: BlobFileStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  private stored(name: string, size: number): StoredFile {
    const { folder, name: leaf } = splitPath(name);
    return { itemId: name, name: leaf, folder, size, webUrl: null };
  }

  /** Blob folders are virtual: nothing to create. */
  async ensureFolder(path: string): Promise<void> {
    normalizePath(path);
    return Promise.resolve();
  }

  private async freeName(folder: string, name: string): Promise<string> {
    for (let n = 0; n < 1000; n++) {
      const candidate = `${normalizePath(folder)}/${numberedName(name, n)}`;
      if (!(await this.container.exists(candidate))) return candidate;
    }
    throw new FileStoreError('FAILED', 'Too many files with this name');
  }

  async upload(path: string, stream: Readable, size: number, mime: string): Promise<StoredFile> {
    const { folder, name } = splitPath(path);
    const target = await this.freeName(folder, name);
    try {
      // exactChunks holds the stream to `size`: a short or long body fails before the commit.
      await this.container.upload(
        target,
        Readable.from(exactChunks(stream, size, 1024 * 1024)),
        mime,
      );
    } catch (err) {
      if (err instanceof BlobConflictError) {
        throw new FileStoreError('FAILED', 'Another upload took this name; try again');
      }
      throw err;
    }
    return this.stored(target, size);
  }

  async list(path: string): Promise<StoredFile[]> {
    const items = await this.container.list(normalizePath(path));
    return items
      .map((i) => this.stored(i.name, i.size))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(itemId: string): Promise<StoredFile | null> {
    const size = await this.container.size(normalizePath(itemId));
    return size === null ? null : this.stored(itemId, size);
  }

  async getDownloadUrl(
    itemId: string,
    opts: { fileName: string; mime?: string },
  ): Promise<DownloadLink> {
    if (!(await this.get(itemId)))
      throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    const expiresAt = new Date(this.now().getTime() + (this.opts.linkTtlMs ?? 5 * 60_000));
    const mime = opts.mime ?? 'application/octet-stream';
    const url = await this.container.readUrl(itemId, expiresAt, opts.fileName, mime);
    return { url, expiresAt };
  }

  async move(itemId: string, folder: string): Promise<StoredFile> {
    const current = await this.get(itemId);
    if (!current) throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    const target = await this.freeName(folder, current.name);
    await this.container.copy(itemId, target);
    await this.container.delete(itemId);
    return this.stored(target, current.size);
  }

  async delete(itemId: string, removedFolder: string): Promise<StoredFile> {
    const { folder } = splitPath(itemId);
    return this.move(itemId, `${normalizePath(removedFolder)}/${folderName(folder)}`);
  }
}
