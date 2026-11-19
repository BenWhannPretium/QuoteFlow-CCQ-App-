import { inflateRawSync } from 'node:zlib';

import { OFFER_DRAFT_TEXT } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { renderOfferLetterDocx } from './offer-letter-docx';
import { blankOfferLetterTemplate, syntheticOfferLetter } from './offer-letter-sample';

/**
 * FB-20: the renderer, checked by opening the .docx as a zip and reading its XML (no binary snapshots).
 * The layout itself was checked by eye in Word (see the PR).
 */

/** The entries of a zip file (stored or deflated), from its central directory. Test-only. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    out.set(name, method === 0 ? data : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const xmlOf = (files: Map<string, Buffer>, prefix: string) =>
  [...files.entries()]
    .filter(([n]) => n.startsWith(prefix))
    .map(([, b]) => b.toString('utf8'))
    .join('\n');

/** The document's visible text, run by run (tags stripped, entities decoded once). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => m[1]!)
    .join('|')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

async function render(model = syntheticOfferLetter()) {
  const bytes = await renderOfferLetterDocx(model);
  const files = unzip(bytes);
  return {
    bytes,
    files,
    body: xmlOf(files, 'word/document.xml'),
    headers: xmlOf(files, 'word/header'),
    footers: xmlOf(files, 'word/footer'),
  };
}

describe('renderOfferLetterDocx', () => {
  it('is a Word document (a zip) with the parts Word needs', async () => {
    const { bytes, files } = await render();
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('word/document.xml')).toBe(true);
    expect([...files.keys()].some((n) => n.startsWith('word/media/') && n.endsWith('.png'))).toBe(
      true,
    );
  });

  it('prints the title, the quote number, each item row and the prices as $#,##0.00', async () => {
    const { body } = await render();
    const text = textOf(body);
    expect(text).toContain('Offer Letter');
    expect(text).toContain('CCQ-2026-00042');
    expect(text).toContain('Northwind Synthetic Beverages');
    expect(text).toContain('Alex Buyer, Packaging Procurement');
    for (const s of [
      '16 oz round bottle · Round, 38-400 neck',
      '32 oz oblong bottle · Oblong, 38-400 neck, handle',
      '38 mm closure · Ribbed, 38-400 continuous thread',
      'NW-16R-001',
      '$82.53',
      '$141.50',
      '$21.75',
      '$48,500.00',
      '$6,800.00',
      '1,200,000 pcs',
      'Plant B (synthetic)',
      'Piece price per 1,000 pcs',
      'Pricing assumptions',
      'This offer is valid until December 16, 2026.',
      'Jordan Example',
    ]) {
      expect(text).toContain(s);
    }
    expect(text).not.toMatch(/undefined|NaN|\{\{|\}\}|null/);
  });

  it("FB-24: prints a concept quote's assumptions, and nothing of the kind on any other quote", async () => {
    const concept = textOf(
      (
        await render(
          syntheticOfferLetter({ conceptAssumptions: 'about 28 g, PET, one-color print' }),
        )
      ).body,
    );
    expect(concept).toContain(
      'This is a concept quote. It assumes: about 28 g, PET, one-color print',
    );
    const standard = textOf((await render()).body);
    expect(standard).not.toContain('concept quote');
    expect(standard).not.toMatch(/\{\{|\}\}/);
  });

  it('carries the DRAFT line in the header while the wording is not approved, and not after', async () => {
    const draft = await render(syntheticOfferLetter({ wordingApproved: false }));
    expect(textOf(draft.headers)).toContain(OFFER_DRAFT_TEXT);
    expect(textOf(draft.body)).not.toContain(OFFER_DRAFT_TEXT);
    const approved = await render(syntheticOfferLetter({ wordingApproved: true }));
    expect(textOf(approved.headers)).not.toContain('DRAFT');
    expect(textOf(approved.headers)).toContain('CCQ-2026-00042');
  });

  it('numbers the pages in the footer', async () => {
    const { footers } = await render();
    expect(footers).toMatch(/PAGE/);
    expect(footers).toMatch(/NUMPAGES/);
    expect(textOf(footers)).toContain('Confidential');
  });

  it('omits a price column no item has', async () => {
    const { body } = await render(syntheticOfferLetter({ items: 1 }));
    const text = textOf(body);
    expect(text).toContain('Molds');
    expect(text).not.toContain('Change parts');
    expect(text).not.toContain('$0.00');
  });

  it('escapes text: <, & and quotes in a customer name stay text', async () => {
    const name = 'Acme <Bottles> & "Caps" \'Co\'';
    const { body } = await render(syntheticOfferLetter({ customerName: name }));
    expect(body).not.toContain('<Bottles>');
    expect(body).toContain('&lt;Bottles&gt; &amp;');
    expect(textOf(body)).toContain(name);
  });

  it('renders the blank, rebranded template with [Brackets] for the facts', async () => {
    const { body } = await render(blankOfferLetterTemplate());
    const text = textOf(body);
    for (const s of [
      '[Customer]',
      '[Attention]',
      '[Part #]',
      '[Place of manufacture]',
      '$[0.00]',
    ]) {
      expect(text).toContain(s);
    }
  });
});
