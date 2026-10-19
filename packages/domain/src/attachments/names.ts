import { DomainError } from '../errors';
import { fileExtension } from './file-types';

/** Longest stored name (SharePoint allows 400 characters for the whole path; keep plenty spare). */
export const STORED_NAME_MAX = 120;

/** Characters SharePoint / OneDrive refuse, plus `#` and `%` that break older clients' links. */
const ILLEGAL = /["*:<>?/\\|#%]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|\.lock)$/i;

/**
 * The name a file is stored under: no path, no characters SharePoint refuses, no leading `~$` or
 * `_vti_`, no reserved device names, at most 120 characters, with its (lower-case) extension. The
 * original name is kept in the database as metadata.
 */
export function sanitizeFileName(original: string): string {
  const ext = fileExtension(original);
  const leaf = (original.split(/[\\/]/).pop() ?? '').normalize('NFC');
  let base = ext ? leaf.slice(0, leaf.length - ext.length - 1) : leaf;
  base = base
    .replace(/\s+/g, ' ')
    .replace(CONTROL, '')
    .replace(ILLEGAL, '_')
    .replace(/^~\$/, '')
    .replace(/^_vti_/i, 'vti_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (!base || RESERVED.test(base)) base = base ? `${base}_` : 'file';
  const room = STORED_NAME_MAX - (ext ? ext.length + 1 : 0);
  base =
    [...base]
      .slice(0, room)
      .join('')
      .replace(/[\s.]+$/, '') || 'file';
  return ext ? `${base}.${ext}` : base;
}

/** Folder segments: letters, digits, space, `_ . -`; no leading/trailing dot or space; no `..`. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 _.-]*$/;

export function isSafeFolderPath(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.length > 0 &&
    segments.every((s) => SEGMENT.test(s) && !/[ .]$/.test(s) && !s.includes('..'))
  );
}

export type FolderVariables = Partial<Record<'quote_number' | 'draft_id', string>>;

/**
 * `CCQ/{quote_number}` → `CCQ/CCQ-2026-00001`. Unknown or missing placeholders, and any segment that
 * isn't a safe folder name, fail with INVALID_CONFIG (the template is admin config, D-SP).
 */
export function renderFolderTemplate(template: string, vars: FolderVariables): string {
  const path = template
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\{([a-z_]+)\}/g, (_, key: string) => {
      const value = vars[key as keyof FolderVariables];
      if (!value) {
        throw new DomainError(
          'INVALID_CONFIG',
          `Folder template ${template} needs {${key}}, which is not available here`,
        );
      }
      return value;
    });
  if (!isSafeFolderPath(path)) {
    throw new DomainError('INVALID_CONFIG', `Folder ${path} is not a safe SharePoint folder path`);
  }
  return path;
}
