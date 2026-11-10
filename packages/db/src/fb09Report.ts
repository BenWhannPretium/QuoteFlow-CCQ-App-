import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';

/**
 * FB-09 read-only report (`pnpm --filter @ccq/db fb09:report`): which quotes still carry a value that
 * Danielle Leu's lists (2026-11-09) retired, so a person can decide what to do. It changes nothing and
 * never remaps real quotes (the synthetic and demo seeds do their own mapping).
 *
 * - Resin: quotes whose resin is PCR_HDPE, PCR_PET, PETG, PVC or BIO_RESIN. They keep their code and show
 *   the label with "(no longer offered)".
 * - Plant (F-057): engineering reviews (site, preform plant, blow plant) and capacity-evidence rows still on a
 *   placeholder plant (PLANT_01 to PLANT_03). FB-13 loaded Jim Zweifel's 22 locations (2026-11-10) and retired
 *   the placeholders; there is no automatic mapping from a placeholder to a real location.
 * - Machine type (FB-13, F-057): engineering reviews still on a retired placeholder machine type, with the
 *   suggested new value. A suggestion is only a suggestion: nothing is remapped here.
 */
export const RETIRED_RESIN_CODES = ['PCR_HDPE', 'PCR_PET', 'PETG', 'PVC', 'BIO_RESIN'] as const;
export const PLACEHOLDER_PLANT_CODES = ['PLANT_01', 'PLANT_02', 'PLANT_03'] as const;

/** The retired placeholder machine types and the code Jim Zweifel's list suggests instead (FB-13). */
export const RETIRED_MACHINE_TYPE_CODES = [
  'EBM_SHUTTLE',
  'EBM_WHEEL',
  'IBM_PRESS',
  'ISBM_1STEP',
  'ISBM_2STEP',
  'INJECTION_PRESS',
  'OTHER',
] as const;
export const MACHINE_TYPE_OLD_TO_NEW: Readonly<
  Record<(typeof RETIRED_MACHINE_TYPE_CODES)[number], { suggested: string; note: string }>
> = {
  EBM_SHUTTLE: { suggested: 'EBM', note: 'EBM (shuttle)' },
  EBM_WHEEL: { suggested: 'EBM', note: 'EBM (wheel; inactive since FB-03)' },
  IBM_PRESS: { suggested: 'IBM', note: 'IBM' },
  ISBM_1STEP: { suggested: 'ISBM', note: 'ISBM (single-stage)' },
  ISBM_2STEP: { suggested: 'ISBM', note: 'ISBM (two-stage)' },
  INJECTION_PRESS: {
    suggested: 'INJ-CAP, INJ-PREFORM or INJ-OTHER',
    note: 'injection: Engineering chooses which',
  },
  OTHER: { suggested: '(none)', note: 'no equivalent on the new list: Engineering chooses' },
};

export interface Fb09Report {
  retiredResin: { code: string; quoteNumbers: string[] }[];
  placeholderPlants: {
    code: string;
    reviewQuoteNumbers: string[];
    capacityQuoteNumbers: string[];
  }[];
  /** FB-13: reviews on a retired placeholder machine type, with the suggested new value. */
  retiredMachineTypes: {
    code: string;
    suggested: string;
    note: string;
    quoteNumbers: string[];
  }[];
  /**
   * FB-13: whether each placeholder is now inactive. A placeholder an Admin edited or the business
   * approved is left active by migration 0039 and shows here as "still active".
   */
  placeholderStatus: { list: 'plant' | 'machine_type'; code: string; status: string }[];
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
    SELECT c.code, q.quote_number FROM eng_review er JOIN quote q ON q.id = er.quote_id
    CROSS JOIN LATERAL (VALUES (er.plant_code), (er.preform_plant_code), (er.blow_plant_code)) AS c(code)
    WHERE c.code IN (${list(PLACEHOLDER_PLANT_CODES)})
    ORDER BY c.code, q.quote_number`);
  const machine = await db.execute<{ code: string; quote_number: string }>(sql`
    SELECT er.machine_type AS code, q.quote_number FROM eng_review er JOIN quote q ON q.id = er.quote_id
    WHERE er.machine_type IN (${list(RETIRED_MACHINE_TYPE_CODES)})
    ORDER BY er.machine_type, q.quote_number`);
  const status = await db.execute<{ list_key: string; code: string; active: boolean }>(sql`
    SELECT list_key, code, active FROM value_list
    WHERE (list_key = 'plant' AND code IN (${list(PLACEHOLDER_PLANT_CODES)}))
       OR (list_key = 'machine_type' AND code IN (${list(RETIRED_MACHINE_TYPE_CODES)}))`);
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
  const m = group([...machine]);
  const uniq = (xs: string[] | undefined) => [...new Set(xs ?? [])];
  const statusOf = (listKey: string, code: string) => {
    const row = [...status].find((x) => x.list_key === listKey && x.code === code);
    return !row ? 'not on the list' : row.active ? 'still active (not retired)' : 'retired';
  };
  return {
    retiredResin: RETIRED_RESIN_CODES.map((code) => ({ code, quoteNumbers: uniq(r.get(code)) })),
    placeholderPlants: PLACEHOLDER_PLANT_CODES.map((code) => ({
      code,
      reviewQuoteNumbers: uniq(e.get(code)),
      capacityQuoteNumbers: uniq(c.get(code)),
    })),
    retiredMachineTypes: RETIRED_MACHINE_TYPE_CODES.map((code) => ({
      code,
      ...MACHINE_TYPE_OLD_TO_NEW[code],
      quoteNumbers: uniq(m.get(code)),
    })),
    placeholderStatus: [
      ...PLACEHOLDER_PLANT_CODES.map((code) => ({
        list: 'plant' as const,
        code,
        status: statusOf('plant', code),
      })),
      ...RETIRED_MACHINE_TYPE_CODES.map((code) => ({
        list: 'machine_type' as const,
        code,
        status: statusOf('machine_type', code),
      })),
    ],
  };
}

export function renderFb09Report(report: Fb09Report, now: Date): string {
  const lines = [`FB-09 report, ${now.toISOString()} (read only; quote numbers only)`, ''];
  lines.push('Quotes with a retired resin (kept as is; shown as "(no longer offered)"):');
  for (const r of report.retiredResin) {
    lines.push(`  ${r.code}: ${r.quoteNumbers.length ? r.quoteNumbers.join(', ') : '(none)'}`);
  }
  lines.push(
    '',
    'Quotes on a retired placeholder plant (kept as is; choose one of the 22 locations, there is no automatic mapping):',
  );
  for (const p of report.placeholderPlants) {
    lines.push(
      `  ${p.code}: reviews ${p.reviewQuoteNumbers.join(', ') || '(none)'}; capacity ${p.capacityQuoteNumbers.join(', ') || '(none)'}`,
    );
  }
  lines.push(
    '',
    'Quotes on a retired machine type, with the suggested new value (nothing is remapped):',
  );
  for (const t of report.retiredMachineTypes) {
    lines.push(
      `  ${t.code} -> ${t.suggested} (${t.note}): ${t.quoteNumbers.join(', ') || '(none)'}`,
    );
  }
  lines.push('', 'Placeholder plants and machine types (FB-13):');
  for (const x of report.placeholderStatus) lines.push(`  ${x.list} ${x.code}: ${x.status}`);
  return `${lines.join('\n')}\n`;
}
