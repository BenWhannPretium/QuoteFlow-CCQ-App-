import { AzureBlobContainer, BlobFileStore } from './blob';
import { createGraphCredential, GraphClient, type GraphCredentialConfig } from './client';
import type { FileStore, FileStoreLogger } from './filestore';
import { LocalFileStore, type LocalFileStoreOptions } from './local';
import { SharePointFileStore } from './sharepoint';

/**
 * `FILESTORE_MODE`: `sharepoint` (the target, from M7), `blob` (the fallback, same interface) or
 * `local` (development and CI). Switching is configuration only.
 */
export type FileStoreConfig =
  | {
      mode: 'sharepoint';
      /** The document library (drive) on the CCQ site. The site id is for the record (Sites.Selected). */
      driveId: string;
      credential: GraphCredentialConfig;
    }
  | {
      mode: 'blob';
      /** https://<account>.blob.core.windows.net */
      accountUrl: string;
      container: string;
      credential: GraphCredentialConfig;
    }
  | ({ mode: 'local' } & LocalFileStoreOptions);

export function createFileStore(
  config: FileStoreConfig,
  options: { logger?: FileStoreLogger } = {},
): FileStore {
  switch (config.mode) {
    case 'sharepoint':
      return new SharePointFileStore(
        new GraphClient({ credential: createGraphCredential(config.credential), ...options }),
        { driveId: config.driveId, ...options },
      );
    case 'blob':
      return new BlobFileStore(
        new AzureBlobContainer({
          accountUrl: config.accountUrl,
          container: config.container,
          credential: createGraphCredential(config.credential),
        }),
      );
    case 'local': {
      const { mode: _mode, ...local } = config;
      return new LocalFileStore(local);
    }
  }
}
