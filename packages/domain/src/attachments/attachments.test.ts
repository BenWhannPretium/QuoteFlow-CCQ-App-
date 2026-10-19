import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors';
import { makeActor, KAM_ID, NOW } from '../test-utils';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_FILE_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_SETTINGS_SEED,
  attachmentRemoval,
  canUploadAttachment,
  checkFileContent,
  checkUploadRequest,
  drawingStatusAfterUpload,
  fileExtension,
  fileTypeForName,
  isSafeFolderPath,
  parseAttachmentSettings,
  renderFolderTemplate,
  sanitizeFileName,
  sniffMatches,
  type FileFormat,
} from './index';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const igesLine = `${'Bottle model from CAD'.padEnd(72)}S      1\n`;

/** One genuine-looking head per format. */
const GOOD: Record<FileFormat, Uint8Array> = {
  pdf: bytes('%PDF-1.7\n%âãÏÓ\n'),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'JFIF'),
  heic: bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'),
  dwg: bytes('AC1032', [0, 0, 0, 0, 0]),
  dxf: bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'),
  step: bytes('\xEF\xBB\xBFISO-10303-21;\nHEADER;\n'),
  iges: bytes(igesLine),
  xlsx: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0], '[Content_Types].xml'),
  docx: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0], '[Content_Types].xml'),
  msg: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
  eml: bytes('Received: from mail.example.com\r\nFrom: a@example.com\r\n'),
};

const EXE = bytes('MZ', [0x90, 0, 3, 0, 0, 0, 4, 0]);
const HTML = bytes('<!doctype html><html><body>hi</body></html>');

describe('file types and sniffing', () => {
  it('accepts exactly the B-16 list', () => {
    expect([...ATTACHMENT_EXTENSIONS].sort()).toEqual(
      [
        'pdf',
        'png',
        'jpg',
        'jpeg',
        'heic',
        'dwg',
        'dxf',
        'step',
        'stp',
        'igs',
        'xlsx',
        'docx',
        'msg',
        'eml',
      ].sort(),
    );
    expect(ATTACHMENT_MAX_BYTES).toBe(104_857_600);
  });

  it.each(ATTACHMENT_FILE_TYPES.map((t) => [t.format]))('%s: genuine content passes', (f) => {
    expect(sniffMatches(f, GOOD[f])).toBe(true);
  });

  it.each(ATTACHMENT_FILE_TYPES.map((t) => [t.format]))(
    '%s: an executable or HTML page with that extension fails',
    (f) => {
      expect(sniffMatches(f, EXE)).toBe(false);
      expect(sniffMatches(f, HTML)).toBe(false);
    },
  );

  it('does not confuse formats with each other', () => {
    expect(sniffMatches('pdf', GOOD.png)).toBe(false);
    expect(sniffMatches('jpeg', GOOD.png)).toBe(false);
    expect(sniffMatches('heic', bytes([0, 0, 0, 0x18], 'ftypisom'))).toBe(false); // an MP4
    expect(sniffMatches('dxf', bytes('0\nSECTION', [0]))).toBe(false); // NUL: not text
    expect(sniffMatches('dxf', bytes('AutoCAD Binary DXF\r\n', [0x1a, 0]))).toBe(true);
    expect(sniffMatches('dxf', bytes('999\nmade by CAD\n0\nSECTION'))).toBe(true);
    expect(sniffMatches('iges', bytes('short line S\n'))).toBe(false);
    expect(sniffMatches('iges', bytes(igesLine.replace('S      1', 'G      1')))).toBe(false);
    expect(sniffMatches('eml', bytes('Hello there, no headers'))).toBe(false);
    expect(sniffMatches('step', bytes('ISO-10303-28;'))).toBe(false);
  });

  it('finds a PDF header after leading junk (within 1 KB) only', () => {
    expect(sniffMatches('pdf', bytes('\r\n\r\n%PDF-1.4'))).toBe(true);
    expect(sniffMatches('pdf', bytes(' '.repeat(1100), '%PDF-1.4'))).toBe(false);
  });

  it('maps names to types case-insensitively; no extension is no type', () => {
    expect(fileTypeForName('Drawing.PDF')?.mime).toBe('application/pdf');
    expect(fileTypeForName('photo.JPEG')?.format).toBe('jpeg');
    expect(fileTypeForName('model.stp')?.format).toBe('step');
    expect(fileTypeForName('archive.zip')).toBeUndefined();
    expect(fileTypeForName('README')).toBeUndefined();
    expect(fileExtension('.bashrc')).toBe('');
    expect(fileExtension('C:\\temp\\a.b\\c.DWG')).toBe('dwg');
    expect(fileExtension('trailing.')).toBe('');
  });
});

describe('checkUploadRequest / checkFileContent', () => {
  it('passes a normal drawing', () => {
    const r = checkUploadRequest({ fileName: 'a.pdf', size: 1000, kind: 'bottle_drawing' });
    expect(r.errors).toEqual([]);
    expect(r.type?.format).toBe('pdf');
  });

  it('rejects type, size and kind with field-level messages', () => {
    const r = checkUploadRequest({ fileName: 'a.exe', size: ATTACHMENT_MAX_BYTES + 1, kind: 'x' });
    expect(r.errors.map((e) => [e.field, e.code])).toEqual([
      ['file', 'INVALID_VALUE'],
      ['file', 'INVALID_VALUE'],
      ['kind', 'INVALID_VALUE'],
    ]);
    expect(r.errors[0]!.message).toContain('pdf');
    expect(r.errors[1]!.message).toContain('100 MB');
    expect(
      checkUploadRequest({ fileName: 'a.pdf', size: 0, kind: 'spec' }).errors[0]!.message,
    ).toBe('The file is empty');
    expect(checkUploadRequest({ fileName: 'a.pdf', size: 1.5, kind: 'spec' }).errors).toHaveLength(
      1,
    );
    expect(
      checkUploadRequest({ fileName: 'a.pdf', size: ATTACHMENT_MAX_BYTES, kind: 'spec' }).errors,
    ).toEqual([]);
  });

  it('names the expected format when the content does not match', () => {
    const pdf = fileTypeForName('x.pdf')!;
    expect(checkFileContent(pdf, GOOD.pdf)).toBeNull();
    const err = checkFileContent(pdf, EXE);
    expect(err).toBeInstanceOf(DomainError);
    expect(err!.message).toContain('PDF');
    expect(err!.field).toBe('file');
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['Bottle drawing v2.PDF', 'Bottle drawing v2.pdf'],
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Users\\kam\\spec.xlsx', 'spec.xlsx'],
    ['a:b*c?"d<e>f|g#h%i.pdf', 'a_b_c__d_e_f_g_h_i.pdf'],
    ['  .hidden name. .pdf', 'hidden name.pdf'],
    ['~$lock.docx', 'lock.docx'],
    ['_vti_bin.pdf', 'vti_bin.pdf'],
    ['CON.pdf', 'CON_.pdf'],
    ['tab\there\u0007.png', 'tab here.png'],
    ['.pdf', 'pdf'], // a dot-file: no extension
    ['...', 'file'],
    ['e\u0301té.jpg', 'été.jpg'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('caps the length at 120 characters and keeps the extension', () => {
    const out = sanitizeFileName(`${'x'.repeat(300)}.step`);
    expect(out).toHaveLength(120);
    expect(out.endsWith('.step')).toBe(true);
  });
});

describe('folders and settings', () => {
  it('renders the seed templates', () => {
    expect(renderFolderTemplate('CCQ/{quote_number}', { quote_number: 'CCQ-2026-00001' })).toBe(
      'CCQ/CCQ-2026-00001',
    );
    expect(renderFolderTemplate('/CCQ/_drafts/{draft_id}/', { draft_id: 'abc-1' })).toBe(
      'CCQ/_drafts/abc-1',
    );
  });

  it('refuses a missing placeholder and unsafe paths', () => {
    expect(() => renderFolderTemplate('CCQ/{quote_number}', {})).toThrow(/quote_number/);
    expect(() => renderFolderTemplate('CCQ/{quote_number}', { quote_number: '../x' })).toThrow(
      DomainError,
    );
    expect(isSafeFolderPath('CCQ/_removed')).toBe(true);
    expect(isSafeFolderPath('CCQ//x')).toBe(false);
    expect(isSafeFolderPath('CCQ/x.')).toBe(false);
    expect(isSafeFolderPath('CCQ/a..b')).toBe(false);
    expect(isSafeFolderPath('CCQ/a:b')).toBe(false);
  });

  it('parses attachment_settings with per-key fallback', () => {
    expect(parseAttachmentSettings(null)).toEqual(ATTACHMENT_SETTINGS_SEED);
    expect(parseAttachmentSettings({ quoteFolder: 'ERF/{quote_number}/CCQ' })).toEqual({
      ...ATTACHMENT_SETTINGS_SEED,
      quoteFolder: 'ERF/{quote_number}/CCQ',
    });
    expect(parseAttachmentSettings({ uploaderRemoveHours: 0 }).uploaderRemoveHours).toBe(0);
    for (const bad of [
      [],
      'x',
      { quoteFolder: '' },
      { quoteFolder: 'CCQ/{draft_id}' },
      { removedFolder: 'CCQ/{quote_number}' },
      { uploaderRemoveHours: -1 },
      { uploaderRemoveHours: 1.5 },
    ]) {
      expect(() => parseAttachmentSettings(bad)).toThrow(DomainError);
    }
  });
});

describe('permissions and side effects', () => {
  const quote = { kamUserId: KAM_ID, region: 'NA' };
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  const settings = { uploaderRemoveHours: 24 };

  it('upload follows attachment.upload and data scope', () => {
    expect(canUploadAttachment(makeActor('KAM', { userId: KAM_ID }), quote)).toBe(true);
    expect(canUploadAttachment(makeActor('Engineer'), quote)).toBe(true);
    expect(canUploadAttachment(makeActor('Approver'), quote)).toBe(false);
    expect(canUploadAttachment(makeActor('Leadership'), quote)).toBe(false);
    expect(canUploadAttachment(makeActor('Admin'), quote)).toBe(false);
    expect(canUploadAttachment(makeActor('KAM', { scope: { type: 'owner' } }), quote)).toBe(false);
  });

  it('the uploader may remove within the window; Admin always; nobody else', () => {
    const kam = makeActor('KAM', { userId: KAM_ID });
    const file = { uploadedBy: KAM_ID, createdAt: hoursAgo(23), onOpenDraft: false };
    expect(attachmentRemoval(kam, file, NOW, settings).allowed).toBe(true);
    const late = attachmentRemoval(kam, { ...file, createdAt: hoursAgo(24) }, NOW, settings);
    expect(late.allowed).toBe(false);
    expect(late.reason).toContain('24 hours');
    expect(
      attachmentRemoval(makeActor('Admin'), { ...file, createdAt: hoursAgo(9999) }, NOW, settings)
        .allowed,
    ).toBe(true);
    expect(attachmentRemoval(makeActor('SalesLeader'), file, NOW, settings).allowed).toBe(false);
    expect(
      attachmentRemoval(kam, { ...file, createdAt: hoursAgo(1) }, NOW, { uploaderRemoveHours: 0 })
        .allowed,
    ).toBe(false);
  });

  it("an open draft's owner may always remove; a role without upload may not", () => {
    const kam = makeActor('KAM', { userId: KAM_ID });
    expect(
      attachmentRemoval(
        kam,
        { uploadedBy: KAM_ID, createdAt: hoursAgo(500), onOpenDraft: true },
        NOW,
        settings,
      ).allowed,
    ).toBe(true);
    const approver = makeActor('Approver', { userId: KAM_ID });
    expect(
      attachmentRemoval(
        approver,
        { uploadedBy: KAM_ID, createdAt: hoursAgo(1), onOpenDraft: false },
        NOW,
        settings,
      ),
    ).toEqual({ allowed: false, reason: 'Only an Admin can remove it' });
  });

  it('a bottle drawing sets the has-drawing status once', () => {
    const codes = ['HAVE_DRAWING'];
    expect(drawingStatusAfterUpload('bottle_drawing', null, codes)).toBe('HAVE_DRAWING');
    expect(drawingStatusAfterUpload('bottle_drawing', 'COMING', codes)).toBe('HAVE_DRAWING');
    expect(drawingStatusAfterUpload('bottle_drawing', 'HAVE_DRAWING', codes)).toBeNull();
    expect(drawingStatusAfterUpload('spec', 'NONE', codes)).toBeNull();
    expect(drawingStatusAfterUpload('bottle_drawing', 'NONE', [])).toBeNull();
  });
});
