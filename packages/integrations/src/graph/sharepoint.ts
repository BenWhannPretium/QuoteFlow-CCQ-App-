import type { Readable } from 'node:stream';

import type { GraphClient } from './client';
import {
  FileStoreError,
  silentFileStoreLogger,
  type DownloadLink,
  type FileStore,
  type FileStoreLogger,
  type StoredFile,
} from './filestore';
import { encodeGraphPath, folderName, normalizePath, splitPath } from './paths';
import { exactChunks } from './stream';

/** 5 MiB = 16 × 320 KiB: Graph requires every range but the last to be a multiple of 320 KiB. */
export const GRAPH_CHUNK_BYTES = 16 * 320 * 1024;
/** Graph's pre-authenticated download URLs last about an hour; we say less, to be safe. */
const DOWNLOAD_URL_TTL_MS = 50 * 60_000;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  file?: unknown;
  folder?: unknown;
  parentReference?: { path?: string; id?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

const ITEM_SELECT = 'id,name,size,webUrl,file,folder,parentReference';

/** `/drives/{id}/root:/CCQ/CCQ-2026-00001` → `CCQ/CCQ-2026-00001`. */
function folderOf(item: DriveItem): string {
  const path = item.parentReference?.path ?? '';
  const i = path.indexOf('root:');
  return i < 0 ? '' : decodeURIComponent(path.slice(i + 5)).replace(/^\/+/, '');
}

function toStored(item: DriveItem): StoredFile {
  return {
    itemId: item.id,
    name: item.name,
    folder: folderOf(item),
    size: item.size ?? 0,
    webUrl: item.webUrl ?? null,
  };
}

export interface SharePointFileStoreOptions {
  /** The document library (drive) on the CCQ site (`SP_DRIVE_ID`, from M7). */
  driveId: string;
  logger?: FileStoreLogger;
  /** Test seam: smaller chunks (must stay a multiple of 320 KiB). */
  chunkBytes?: number;
  now?: () => Date;
}

/**
 * Files in a SharePoint document library through Microsoft Graph, app-only with `Sites.Selected`
 * (write) on the CCQ site and nothing else. Uploads stream through a resumable upload session in
 * 5 MB ranges; the API never holds the whole file.
 */
export class SharePointFileStore implements FileStore {
  readonly kind = 'sharepoint' as const;
  private readonly drive: string;
  private readonly logger: FileStoreLogger;
  private readonly chunkBytes: number;
  private readonly now: () => Date;
  /** Folders known to exist (this process created or found them). */
  private readonly folders = new Set<string>();

  constructor(
    private readonly graph: GraphClient,
    opts: SharePointFileStoreOptions,
  ) {
    this.drive = `/drives/${encodeURIComponent(opts.driveId)}`;
    this.logger = opts.logger ?? silentFileStoreLogger;
    this.chunkBytes = opts.chunkBytes ?? GRAPH_CHUNK_BYTES;
    if (this.chunkBytes % (320 * 1024) !== 0) {
      throw new Error('SharePoint upload chunks must be a multiple of 320 KiB');
    }
    this.now = opts.now ?? (() => new Date());
  }

  private byPath = (path: string) => `${this.drive}/root:/${encodeGraphPath(path)}:`;
  private byId = (id: string) => `${this.drive}/items/${encodeURIComponent(id)}`;

  private async folderItem(path: string): Promise<DriveItem | null> {
    try {
      return await this.graph.json<DriveItem>({
        method: 'GET',
        path: `${this.byPath(path)}?$select=id,name,folder`,
      });
    } catch (err) {
      if (err instanceof FileStoreError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async ensureFolder(path: string): Promise<void> {
    const target = normalizePath(path);
    if (this.folders.has(target)) return;
    if (await this.folderItem(target)) {
      this.folders.add(target);
      return;
    }
    const segments = target.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join('/');
      if (this.folders.has(prefix)) continue;
      const parent = segments.slice(0, i - 1).join('/');
      const parentPath = parent ? `${this.byPath(parent)}/children` : `${this.drive}/root/children`;
      try {
        await this.graph.json({
          method: 'POST',
          path: parentPath,
          body: {
            name: segments[i - 1],
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          },
        });
      } catch (err) {
        // 409 nameAlreadyExists: someone (or an earlier run) made it. Anything else is real.
        if (!(err instanceof FileStoreError && err.status === 409)) throw err;
      }
      this.folders.add(prefix);
    }
  }

  async upload(path: string, stream: Readable, size: number, _mime: string): Promise<StoredFile> {
    const { folder, name } = splitPath(path);
    await this.ensureFolder(folder);
    const session = await this.graph.json<{ uploadUrl: string }>({
      method: 'POST',
      path: `${this.byPath(`${folder}/${name}`)}/createUploadSession`,
      body: { item: { '@microsoft.graph.conflictBehavior': 'rename', name } },
    });
    let offset = 0;
    let finished: DriveItem | null = null;
    try {
      for await (const chunk of exactChunks(stream, size, this.chunkBytes)) {
        const end = offset + chunk.length - 1;
        const res = await this.graph.send({
          method: 'PUT',
          path: session.uploadUrl,
          anonymous: true, // the upload URL is pre-authenticated; never send the bearer token to it
          headers: {
            'content-length': String(chunk.length),
            'content-range': `bytes ${offset}-${end}/${size}`,
          },
          rawBody: chunk,
        });
        offset = end + 1;
        if (res.status === 200 || res.status === 201) finished = (await res.json()) as DriveItem;
      }
    } catch (err) {
      // Abandon the session so the partial bytes are discarded now rather than at expiry.
      await this.graph
        .send({ method: 'DELETE', path: session.uploadUrl, anonymous: true })
        .catch(() => undefined);
      this.logger.warn(
        { op: 'upload', code: err instanceof FileStoreError ? err.code : 'FAILED', size },
        'sharepoint upload abandoned',
      );
      throw err;
    }
    if (!finished) throw new FileStoreError('FAILED', 'The upload session did not complete');
    this.logger.info({ op: 'upload', size, chunks: Math.ceil(size / this.chunkBytes) }, 'uploaded');
    return toStored(finished);
  }

  async list(path: string): Promise<StoredFile[]> {
    const out: StoredFile[] = [];
    let next: string | undefined = `${this.byPath(path)}/children?$select=${ITEM_SELECT}&$top=200`;
    try {
      while (next) {
        const page: { value: DriveItem[]; '@odata.nextLink'?: string } = await this.graph.json({
          method: 'GET',
          path: next,
        });
        out.push(...page.value.filter((i) => i.file !== undefined).map(toStored));
        next = page['@odata.nextLink'];
      }
    } catch (err) {
      if (err instanceof FileStoreError && err.code === 'NOT_FOUND') return [];
      throw err;
    }
    return out;
  }

  async get(itemId: string): Promise<StoredFile | null> {
    try {
      return toStored(
        await this.graph.json<DriveItem>({
          method: 'GET',
          path: `${this.byId(itemId)}?$select=${ITEM_SELECT}`,
        }),
      );
    } catch (err) {
      if (err instanceof FileStoreError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async getDownloadUrl(itemId: string, _opts: { fileName: string }): Promise<DownloadLink> {
    const item = await this.graph.json<DriveItem>({
      method: 'GET',
      path: `${this.byId(itemId)}?$select=id,@microsoft.graph.downloadUrl`,
    });
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new FileStoreError('FAILED', 'SharePoint returned no download URL');
    return { url, expiresAt: new Date(this.now().getTime() + DOWNLOAD_URL_TTL_MS) };
  }

  async move(itemId: string, folder: string): Promise<StoredFile> {
    const target = normalizePath(folder);
    await this.ensureFolder(target);
    const parent = await this.folderItem(target);
    if (!parent) throw new FileStoreError('FAILED', 'The target folder is missing');
    const moved = await this.graph.json<DriveItem>({
      method: 'PATCH',
      path: `${this.byId(itemId)}?@microsoft.graph.conflictBehavior=rename&$select=${ITEM_SELECT}`,
      body: { parentReference: { id: parent.id } },
    });
    return toStored(moved);
  }

  async delete(itemId: string, removedFolder: string): Promise<StoredFile> {
    const current = await this.get(itemId);
    if (!current) throw new FileStoreError('NOT_FOUND', 'The file no longer exists');
    return this.move(itemId, `${normalizePath(removedFolder)}/${folderName(current.folder)}`);
  }
}
