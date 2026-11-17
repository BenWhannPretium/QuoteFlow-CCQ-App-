import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { renderOfferLetterDocx } from '../documents/offer-letter-docx';
import { blankOfferLetterTemplate, syntheticOfferLetter } from '../documents/offer-letter-sample';

/**
 * FB-20: write sample offer letters to look at in Word (synthetic data only):
 *   pnpm --filter @ccq/api offer-letter:sample <folder outside the repo>
 * - offer-letter-template.docx   the rebranded template, `[Brackets]` for a quote's facts
 * - offer-letter-sample-3-items.docx   a three-item synthetic letter (DRAFT line on)
 * - offer-letter-sample-1-item-approved.docx   one item, wording approved (no DRAFT line)
 * Never commit a generated letter.
 */
async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: offer-letter-sample <output folder>');
  const out = resolve(dir);
  if (out.startsWith(resolve(import.meta.dirname, '../../../..'))) {
    throw new Error('Write samples outside the repo (generated letters are never committed)');
  }
  mkdirSync(out, { recursive: true });
  const files: [string, Buffer][] = [
    ['offer-letter-template.docx', await renderOfferLetterDocx(blankOfferLetterTemplate())],
    ['offer-letter-sample-3-items.docx', await renderOfferLetterDocx(syntheticOfferLetter())],
    [
      'offer-letter-sample-1-item-approved.docx',
      await renderOfferLetterDocx(syntheticOfferLetter({ items: 1, wordingApproved: true })),
    ],
  ];
  for (const [name, bytes] of files) {
    writeFileSync(join(out, name), bytes);
    process.stdout.write(`wrote ${join(out, name)}\n`);
  }
}

await main();
