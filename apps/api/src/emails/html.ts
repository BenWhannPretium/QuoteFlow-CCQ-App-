/**
 * A tiny tagged template for mail-safe HTML: every interpolated value is escaped unless it was built
 * with `markup` itself (or `raw`), so a quote description can never inject markup into an email.
 */
export class Safe {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

export const raw = (s: string): Safe => new Safe(s);

const render = (value: unknown): string => {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(typeof value === 'string' ? value : `${value as number | bigint | boolean}`);
};

export function markup(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Safe(out);
}
