import type { Readable } from 'node:stream';

/**
 * B-16 (F-13): where attachment bytes live. One interface, three stores, picked by `FILESTORE_MODE`:
 *
 * - `sharepoint`: Microsoft Graph, app-only with `Sites.Selected` on one site (the target, M7);
 * - `blob`: a private Azure Blob container (the fallback if SharePoint access is late or withdrawn);
 * - `local`: a folder on disk (`.data/files`) for development and CI.
 *
 * Paths are folder paths relative to the library / container root, `/`-separated, without leading or
 * trailing slashes (`CCQ/CCQ-2026-00001`). The API builds them from `attachment_settings` only.
 * Item ids are whatever the store uses (a Graph driveItem id, a blob name, a relative path); callers
 * keep the id a call returns, since a move may change it.
 */
export interface StoredFile {
  itemId: string;
  /** The name in storage (a conflict renames: `drawing (1).pdf`). */
  name: string;
  /** Folder path the file is in now. */
  folder: string;
  size: number;
  /** SharePoint's browser link; null for Blob and local. */
  webUrl: string | null;
}

export interface DownloadLink {
  url: string;
  expiresAt: Date;
}

export type FileStoreKind = 'sharepoint' | 'blob' | 'local';

export interface FileStore {
  readonly kind: FileStoreKind;
  /** Create the folder and its parents if missing (idempotent). */
  ensureFolder(path: string): Promise<void>;
  /**
   * Stream `size` bytes into `path` (folder + name). A name already taken is renamed, never
   * overwritten. The stream must deliver exactly `size` bytes (SIZE_MISMATCH when short, TOO_LARGE when
   * long; nothing is kept). Never buffers the whole file: SharePoint uploads in 5 MB chunks through an upload session.
   */
  upload(path: string, stream: Readable, size: number, mime: string): Promise<StoredFile>;
  /** The files directly in a folder (no sub-folders); [] when the folder doesn't exist. */
  list(path: string): Promise<StoredFile[]>;
  /** One file, or null when it no longer exists. */
  get(itemId: string): Promise<StoredFile | null>;
  /**
   * A short-lived, pre-authorized link to the bytes. Blob and local name the download `fileName`
   * (with `mime`); SharePoint's link uses the stored name.
   */
  getDownloadUrl(itemId: string, opts: { fileName: string; mime?: string }): Promise<DownloadLink>;
  /** Move into another folder (created if needed); a taken name is renamed. */
  move(itemId: string, folder: string): Promise<StoredFile>;
  /**
   * Soft delete: move into `removedFolder/<the file's current folder name>/`. Nothing is destroyed;
   * a SharePoint admin can restore it, and the version history comes along.
   */
  delete(itemId: string, removedFolder: string): Promise<StoredFile>;
}

export type FileStoreErrorCode =
  | 'NOT_FOUND'
  /** The stream ended before its declared size. */
  | 'SIZE_MISMATCH'
  /** The stream ran past its declared size. */
  | 'TOO_LARGE'
  | 'INVALID_PATH'
  | 'UNAVAILABLE'
  | 'FORBIDDEN'
  | 'THROTTLED'
  | 'FAILED';

/** A store failure with a data-free code (logs carry the code and the HTTP status, never content). */
export class FileStoreError extends Error {
  constructor(
    readonly code: FileStoreErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FileStoreError';
  }
}

export interface FileStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const silentFileStoreLogger: FileStoreLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
