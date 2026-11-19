import { describe, expect, it } from 'vitest';

import { acceptedFormats } from './accepted-formats';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_FILE_TYPES,
  ATTACHMENT_MAX_BYTES,
  QUOTING_MODEL_KINDS,
} from './file-types';
import { checkUploadRequest } from './rules';

describe('FB-21 Part E: accepted formats as words and as a file-picker accept string', () => {
  it('the three Quoting models take an Excel workbook only, up to the size limit', () => {
    for (const kind of QUOTING_MODEL_KINDS) {
      expect(acceptedFormats(kind)).toMatchObject({
        formatsText: 'Excel workbook (.xlsx)',
        maxMb: 100,
        text: 'Excel workbook (.xlsx), up to 100 MB',
        accept: '.xlsx',
      });
    }
  });

  it('a kind without its own list takes every allowed type', () => {
    const any = acceptedFormats('spec');
    expect(any.types).toEqual(ATTACHMENT_FILE_TYPES);
    expect(any.accept).toBe(ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(','));
    expect(any.formatsText).toMatch(/^PDF \(\.pdf\), PNG image \(\.png\), .+ or Email \(\.eml\)$/);
    expect(any.formatsText).toContain('JPEG image (.jpg, .jpeg)');
    expect(any.text.endsWith(`, up to ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`)).toBe(true);
  });

  it('agrees with what the server accepts', () => {
    for (const kind of QUOTING_MODEL_KINDS) {
      const { accept } = acceptedFormats(kind);
      for (const t of ATTACHMENT_FILE_TYPES) {
        const name = `model.${t.extensions[0]}`;
        const refused = checkUploadRequest({ kind, fileName: name, size: 10 }).errors.length > 0;
        expect(accept.split(',').includes(`.${t.extensions[0]}`), name).toBe(!refused);
      }
    }
  });
});
