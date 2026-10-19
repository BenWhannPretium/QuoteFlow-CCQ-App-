import { FileStoreError } from './filestore';

// eslint-disable-next-line no-control-regex
const SEGMENT = /^[^/\\:*?"<>|#%\u0000-\u001f]+$/;

/** `a/b/` → `a/b`. Rejects empty segments, `.`/`..` and characters no store accepts. */
export function normalizePath(path: string): string {
  const p = path.replace(/^\/+|\/+$/g, '');
  const segments = p.split('/');
  if (!p || segments.some((s) => !SEGMENT.test(s) || s === '.' || s === '..' || s.trim() !== s)) {
    throw new FileStoreError('INVALID_PATH', 'Invalid storage path');
  }
  return p;
}

export function splitPath(path: string): { folder: string; name: string } {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  if (i < 0) throw new FileStoreError('INVALID_PATH', 'A file path needs a folder');
  return { folder: p.slice(0, i), name: p.slice(i + 1) };
}

export const joinPath = (folder: string, name: string) => `${normalizePath(folder)}/${name}`;

/** The last segment of a folder path. */
export const folderName = (folder: string) => normalizePath(folder).split('/').pop()!;

/** `drawing.pdf`, n = 1 → `drawing (1).pdf` (SharePoint's own rename pattern). */
export function numberedName(name: string, n: number): string {
  if (n === 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Graph path addressing: each segment URL-encoded, slashes kept. */
export const encodeGraphPath = (path: string) =>
  normalizePath(path).split('/').map(encodeURIComponent).join('/');
