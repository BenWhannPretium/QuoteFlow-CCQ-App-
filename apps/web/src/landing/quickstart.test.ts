import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { quickstartAnchor, splitQuickstart } from './quickstart';

const SOURCE = fileURLToPath(
  new URL('../../../../docs/uat/quickstart/print.html', import.meta.url),
);
const OUT_HTML = fileURLToPath(new URL('../../public/help/quickstart.html', import.meta.url));
const OUT_CSS = fileURLToPath(new URL('../../public/help/quickstart.css', import.meta.url));

describe('UAT quick-start help page (B-23)', () => {
  const { html, css } = splitQuickstart(readFileSync(SOURCE, 'utf8'));
  if (process.env.UPDATE_QUICKSTART === '1') {
    writeFileSync(OUT_HTML, html);
    writeFileSync(OUT_CSS, css);
  }

  it('public/help is in step with docs/uat/quickstart/print.html (UPDATE_QUICKSTART=1 to rewrite)', () => {
    expect(readFileSync(OUT_HTML, 'utf8')).toBe(html);
    expect(readFileSync(OUT_CSS, 'utf8')).toBe(css);
    expect(html).not.toMatch(/<style|<script/);
  });

  it('every role links to a section that exists', () => {
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'PricingLead',
      'Approver',
      'Leadership',
      'Admin',
    ]) {
      expect(html, role).toContain(`id="${quickstartAnchor(role)}"`);
    }
  });
});
