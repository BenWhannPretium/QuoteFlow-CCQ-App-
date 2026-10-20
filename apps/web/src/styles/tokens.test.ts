import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * WCAG AA contrast for the token pairs QuoteFlow renders (tokens.css). A colour change that drops a
 * pair below 4.5:1 (text) or 3:1 (controls, the rail's focus ring) fails here.
 */
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--pf-[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const light = block(':root');
const themes = { light, dark: { ...light, ...block(':root.dark') } };

const PAIRS: [fg: string, bg: string, min: number][] = [
  ...['--pf-fg', '--pf-fg-2', '--pf-muted', '--pf-copper-text'].flatMap((fg) =>
    ['--pf-bg', '--pf-surface', '--pf-surface-2'].map((bg): [string, string, number] => [
      fg,
      bg,
      4.5,
    ]),
  ),
  ['--pf-control-line', '--pf-surface', 3],
  ['--pf-control-line', '--pf-bg', 3],
  ['--pf-rail-fg', '--pf-rail-bg', 4.5],
  ['--pf-rail-fg', '--pf-rail-bg-2', 4.5],
  ['--pf-rail-muted', '--pf-rail-bg', 4.5],
  ['--pf-rail-muted', '--pf-rail-bg-2', 4.5],
  ['--pf-copper-on-green', '--pf-rail-bg', 3],
  ['--pf-tier-high-fg', '--pf-tier-high-bg', 4.5],
  ['--pf-tier-standard-fg', '--pf-tier-standard-bg', 4.5],
  ['--pf-tier-low-fg', '--pf-tier-low-bg', 4.5],
  ['--pf-warning-fg', '--pf-warning-bg', 4.5],
];

describe.each(Object.entries(themes))('%s theme contrast', (_name, theme) => {
  it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
    expect(theme[fg], fg).toBeDefined();
    expect(theme[bg], bg).toBeDefined();
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(min);
  });
});
