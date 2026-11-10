import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';

/**
 * FB-09 read-only report (`pnpm --filter @ccq/db fb09:report`): which quotes still carry a value that
 * Danielle Leu's lists (2026-11-09) retired, so a person can decide what to do. It changes nothing and
 * never remaps real quotes (the synthetic and demo seeds do their own mapping).
 *
 * - Resin: quotes whose resin is PCR_HDPE, PCR_PET, PETG, PVC or BIO_RESIN. They keep their code and show
 *   the label with "(no longer offered)".
 * - Plant (F-057): engineering reviews and capacity-evidence rows still on a placeholder plant
 *   (PLANT_01 to PLANT_03). The real plant list from Jim Zweifel has not been received.
 */
export const RETIRED_RESIN_CODES = ['PCR_HDPE', 'PCR_PET', 'PETG', 'PVC', 'BIO_RESIN'] as const;
export const PLACEHOLDER_PLANT_CODES = ['PLANT_01', 'PLANT_02', 'PLANT_03'] as const;

export interface Fb09Report {
  retiredResin: { code: string; quoteNumbers: string[] }[];
  placeholderPlants: {
    code: string;
    reviewQuoteNumbers: string[];
    capacityQuoteNumbers: string[];
  }[];
}

const list = (codes: readonly string[]) =>
  sql.join(
    codes.map((c) => sql`${c}`),
    sql`, `,
  );

export async function fb09Report(db: DbOrTx): Promise<Fb09Report> {
  const resin = await db.execute<{ code: string; quote_number: string }>(sql`
    SELECT resin AS code, quote_number FROM quote
    WHERE resin IN (${list(RETIRED_RESIN_CODES)})
    ORDER BY resin, quote_number`);
  const review = await db.execute<{ code: string; quote_number: string }>(sql`
    SELECT er.plant_code AS code, q.quote_number FROM eng_review er JOIN quote q ON q.id = er.quote_id
    WHERE er.plant_code IN (${list(PLACEHOLDER_PLANT_CODES)})
    ORDER BY er.plant_code, q.quote_number`);
  const capacity = await db.execute<{ code: string; quote_number: string }>(sql`
    SELECT ce.site AS code, q.quote_number FROM capacity_evidence ce JOIN quote q ON q.id = ce.quote_id
    WHERE ce.site IN (${list(PLACEHOLDER_PLANT_CODES)})
    ORDER BY ce.site, q.quote_number`);
  const group = (rows: { code: string; quote_number: string }[]) => {
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.code, [...(out.get(r.code) ?? []), r.quote_number]);
    return out;
  };
  const r = group([...resin]);
  const e = group([...review]);
  const c = group([...capacity]);
  const uniq = (xs: string[] | undefined) => [...new Set(xs ?? [])];
  return {
    retiredResin: RETIRED_RESIN_CODES.map((code) => ({ code, quoteNumbers: uniq(r.get(code)) })),
    placeholderPlants: PLACEHOLDER_PLANT_CODES.map((code) => ({
      code,
      reviewQuoteNumbers: uniq(e.get(code)),
      capacityQuoteNumbers: uniq(c.get(code)),
    })),
  };
}

export function renderFb09Report(report: Fb09Report, now: Date): string {
  const lines = [`FB-09 report, ${now.toISOString()} (read only; quote numbers only)`, ''];
  lines.push('Quotes with a retired resin (kept as is; shown as "(no longer offered)"):');
  for (const r of report.retiredResin) {
    lines.push(`  ${r.code}: ${r.quoteNumbers.length ? r.quoteNumbers.join(', ') : '(none)'}`);
  }
  lines.push('', 'Quotes on a placeholder plant (the real plant list is not loaded yet):');
  for (const p of report.placeholderPlants) {
    lines.push(
      `  ${p.code}: reviews ${p.reviewQuoteNumbers.join(', ') || '(none)'}; capacity ${p.capacityQuoteNumbers.join(', ') || '(none)'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
