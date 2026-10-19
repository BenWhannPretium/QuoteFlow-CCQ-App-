/**
 * B-16 (F-13): which files a quote may carry, and the content check behind the extension.
 *
 * The allowed list and the 100 MB cap come from the B-16 prompt (not open decisions). The browser's
 * declared MIME type is never trusted: the server sniffs the first bytes (`sniffMatches`) and stores the
 * canonical MIME type for the extension.
 */

export const ATTACHMENT_KINDS = ['bottle_drawing', 'spec', 'sample_photo', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** 100 MB: the largest file the API accepts (and Graph's upload session is sized for). */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** How many leading bytes `sniffMatches` needs (an IGES start line, a DXF header, an ISO BMFF box). */
export const ATTACHMENT_SNIFF_BYTES = 4096;

export type FileFormat =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'heic'
  | 'dwg'
  | 'dxf'
  | 'step'
  | 'iges'
  | 'xlsx'
  | 'docx'
  | 'msg'
  | 'eml';

export interface AttachmentFileType {
  format: FileFormat;
  /** Lower-case extensions without the dot. */
  extensions: readonly string[];
  /** Canonical MIME type stored for the file (the browser's claim is ignored). */
  mime: string;
  label: string;
}

export const ATTACHMENT_FILE_TYPES: readonly AttachmentFileType[] = [
  { format: 'pdf', extensions: ['pdf'], mime: 'application/pdf', label: 'PDF' },
  { format: 'png', extensions: ['png'], mime: 'image/png', label: 'PNG image' },
  { format: 'jpeg', extensions: ['jpg', 'jpeg'], mime: 'image/jpeg', label: 'JPEG image' },
  { format: 'heic', extensions: ['heic'], mime: 'image/heic', label: 'HEIC photo' },
  { format: 'dwg', extensions: ['dwg'], mime: 'image/vnd.dwg', label: 'AutoCAD drawing' },
  { format: 'dxf', extensions: ['dxf'], mime: 'image/vnd.dxf', label: 'DXF drawing' },
  { format: 'step', extensions: ['step', 'stp'], mime: 'model/step', label: 'STEP model' },
  { format: 'iges', extensions: ['igs'], mime: 'model/iges', label: 'IGES model' },
  {
    format: 'xlsx',
    extensions: ['xlsx'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel workbook',
  },
  {
    format: 'docx',
    extensions: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word document',
  },
  {
    format: 'msg',
    extensions: ['msg'],
    mime: 'application/vnd.ms-outlook',
    label: 'Outlook email',
  },
  { format: 'eml', extensions: ['eml'], mime: 'message/rfc822', label: 'Email' },
];

/** Every allowed extension, for the file picker's `accept` (".pdf,.png,…"). */
export const ATTACHMENT_EXTENSIONS: readonly string[] = ATTACHMENT_FILE_TYPES.flatMap(
  (t) => t.extensions,
);

/** The lower-case extension of a file name ('' when there is none). */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileTypeForName(fileName: string): AttachmentFileType | undefined {
  const ext = fileExtension(fileName);
  return ext ? ATTACHMENT_FILE_TYPES.find((t) => t.extensions.includes(ext)) : undefined;
}

const startsWith = (head: Uint8Array, sig: readonly number[], at = 0) =>
  head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Decode as latin-1 (every byte maps to one char), so offsets stay byte offsets. */
const latin1 = (head: Uint8Array) => String.fromCharCode(...head);

/** Text formats: no NUL bytes, then the text without a UTF-8 BOM and leading whitespace. */
function textStart(head: Uint8Array): string | null {
  if (head.includes(0)) return null;
  return latin1(head)
    .replace(/^\xEF\xBB\xBF/, '')
    .replace(/^\s+/, '');
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * Do the leading bytes look like the format? A renamed executable, a zip called .pdf or an HTML page
 * called .dxf fails. Office files are ZIP containers, so .xlsx / .docx check the ZIP signature only.
 */
export function sniffMatches(format: FileFormat, head: Uint8Array): boolean {
  switch (format) {
    case 'pdf':
      // Readers accept junk before the header within the first 1024 bytes.
      return latin1(head.subarray(0, 1024)).includes('%PDF-');
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'heic':
      return (
        startsWith(head, ascii('ftyp'), 4) &&
        HEIC_BRANDS.has(latin1(head.subarray(8, 12)).toLowerCase())
      );
    case 'dwg':
      return /^AC\d{4}/.test(latin1(head.subarray(0, 6)));
    case 'dxf': {
      if (startsWith(head, ascii('AutoCAD Binary DXF'))) return true;
      const text = textStart(head);
      // An ASCII DXF opens with group code 0 (SECTION) or a 999 comment.
      return text !== null && /^(0|999)\r?\n/.test(text);
    }
    case 'step':
      return textStart(head)?.startsWith('ISO-10303-21;') ?? false;
    case 'iges': {
      if (head.includes(0)) return false;
      // Fixed 80-column records; the first is in the Start section ("S" in column 73).
      const first = latin1(head).split('\n')[0]!.replace(/\r$/, '');
      return first.length >= 73 && first[72] === 'S';
    }
    case 'xlsx':
    case 'docx':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case 'msg':
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'eml': {
      const text = textStart(head);
      // RFC 5322: the message starts with a header field "Name:".
      return text !== null && /^[!-9;-~]+:/.test(text);
    }
  }
}
