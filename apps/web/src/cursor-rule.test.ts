import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');
// Comments sit between rules and would stick to the next selector.
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector list contains `selector`. */
function ruleFor(selector: string): string | undefined {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selectors = m[1]!.split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2]!.replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

// FB-27 (N18-16): Tailwind 4 leaves buttons with the arrow; the equipment BOM link (a button) looked inert.
describe('the hand cursor (global stylesheet)', () => {
  it.each([
    'button:not(:disabled)',
    "[role='button']:not([aria-disabled='true'])",
    "[role='tab']:not([aria-disabled='true'])",
    "[role='menuitem']:not([aria-disabled='true'])",
    'a[href]',
    'summary',
    'select:not(:disabled)',
    "input[type='file']:not(:disabled)",
    "label:has(> input[type='file']:not(:disabled))",
  ])('gives %s the pointer', (selector) => {
    expect(ruleFor(selector)).toContain('cursor: pointer');
  });

  it.each(['button:disabled', 'select:disabled', "[role='button'][aria-disabled='true']"])(
    'says "not now" on %s',
    (selector) => {
      expect(ruleFor(selector)).toContain('cursor: not-allowed');
    },
  );

  it('lives in the base layer, so a component’s own cursor class still wins', () => {
    const layer = css.indexOf('@layer base');
    expect(layer).toBeGreaterThan(-1);
    expect(css.indexOf('button:not(:disabled),', layer)).toBeGreaterThan(layer);
  });
});
