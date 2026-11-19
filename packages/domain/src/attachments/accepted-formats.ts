import {
  ATTACHMENT_FILE_TYPES,
  ATTACHMENT_MAX_BYTES,
  KIND_FORMATS,
  type AttachmentFileType,
  type AttachmentKind,
} from './file-types';

/**
 * FB-21 Part E (the Quoting half of N17-24): what an upload button says it takes, from the same lists the
 * server checks (`KIND_FORMATS`, `ATTACHMENT_FILE_TYPES`, `ATTACHMENT_MAX_BYTES`), so the words and the
 * file picker never drift from the rule. FB-27 reuses it for the other uploads.
 */
export interface AcceptedFormats {
  /** The file types the kind takes, in list order. */
  types: readonly AttachmentFileType[];
  /** "Excel workbook (.xlsx)", or "PDF (.pdf), PNG image (.png) or …" for the general list. */
  formatsText: string;
  /** The size limit in whole MB. */
  maxMb: number;
  /** "Excel workbook (.xlsx), up to 100 MB": shown beside the upload button. */
  text: string;
  /** For the file picker: ".xlsx", or ".pdf,.png,…". */
  accept: string;
}

const MB = 1024 * 1024;

const joinWords = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;

/** The accepted formats and size limit of an attachment kind, as words and as an `accept` string. */
export function acceptedFormats(kind: AttachmentKind): AcceptedFormats {
  const only = KIND_FORMATS[kind];
  const types = only
    ? ATTACHMENT_FILE_TYPES.filter((t) => only.includes(t.format))
    : ATTACHMENT_FILE_TYPES;
  const formatsText = joinWords(
    types.map((t) => `${t.label} (${t.extensions.map((e) => `.${e}`).join(', ')})`),
  );
  const maxMb = Math.floor(ATTACHMENT_MAX_BYTES / MB);
  return {
    types,
    formatsText,
    maxMb,
    text: `${formatsText}, up to ${maxMb} MB`,
    accept: types.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(','),
  };
}
