import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';

/**
 * FB-07 dry run: what migration 0031's data statements would do to THIS database, without changing it.
 * Run it before deploying FB-07 (`pnpm --filter @ccq/db fb07:dry-run`) and keep the output with the
 * release notes. It reads only columns that exist before 0031, so it works on either side of it.
 *
 * - Open quotes: which quotes in Quoting are grandfathered (costing attested, no costing model on file)
 *   and which will need a costing model before costing can be attested and G3 decided.
 * - Config: each workflow row and setting the migration touches, and whether it will change, is
 *   already done, or is skipped (approved, or changed by an admin).
 */

/** Migration 0031's values (kept in step with the SQL by `fb07-migration.int.test.ts`). */
export const FB07 = {
  gateLabel: { from: 'Price approved & capital ready', to: 'Price approved' },
  outcomeLabel: { from: 'Advance to Final Review', to: 'Advance – price approved' },
  outcomeHelp: {
    from: 'The cost sheet is done, the price is approved and capital readiness is confirmed. The quote goes to Final Review.',
  },
  /** The B-26 G3 Advance rule as seeded (the migration extends only this exact value). */
  seededRule: [
    {
      anyOf: [
        {
          allOf: [
            { field: 'pricing_record.price_approved_by', op: 'present' },
            { field: 'pricing_record.price_approved_at', op: 'present' },
          ],
        },
        { field: 'pass_through_eligible', op: 'equals', value: true },
      ],
    },
    { field: 'pricing_record.costing_completed', op: 'equals', value: true },
    { field: 'pricing_record.capital_readiness', op: 'present' },
    {
      anyOf: [
        {
          field: 'pricing_record.capital_readiness',
          op: 'oneOf',
          value: ['not_required', 'pre_approved', 'not_approved'],
        },
        { field: 'pricing_record.capital_pending_justification', op: 'present' },
      ],
    },
    {
      anyOf: [
        { field: 'capital_likely', op: 'equals', value: false },
        {
          field: 'pricing_record.capital_readiness',
          op: 'oneOf',
          value: ['not_required', 'pre_approved'],
        },
      ],
    },
  ],
  /** The two rules 0031 appends. */
  addedRules: [
    {
      anyOf: [
        { field: 'cost_model_on_file', op: 'equals', value: true },
        { field: 'pricing_record.cost_model_requirement', op: 'equals', value: 'grandfathered' },
      ],
    },
    {
      anyOf: [
        { field: 'roi_required', op: 'equals', value: false },
        { field: 'roi_model_on_file', op: 'equals', value: true },
      ],
    },
  ],
} as const;

export type ConfigOutcome =
  'will change' | 'already done' | 'skipped: approved' | 'skipped: admin changed' | 'missing';

export interface Fb07DryRunReport {
  /** In Quoting, costing attested, no costing model: marked grandfathered (they keep working). */
  grandfathered: OpenQuoteRow[];
  /** In Quoting, costing not attested: they need a costing model before costing can be attested. */
  needModel: OpenQuoteRow[];
  config: { item: string; current: string | null; outcome: ConfigOutcome }[];
}

export interface OpenQuoteRow {
  quoteNumber: string;
  status: string;
  version: number;
  pricer: string | null;
  costingAttestedAt: string | null;
}

const rows = async <R>(db: DbOrTx, query: ReturnType<typeof sql>) =>
  (await db.execute(query)) as unknown as R[];

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

function outcomeFor(
  row: { approved_at: Date | string | null } | undefined,
  value: unknown,
  from: unknown,
  to: unknown,
): ConfigOutcome {
  if (!row) return 'missing';
  if (sameJson(value, to)) return 'already done';
  if (row.approved_at) return 'skipped: approved';
  return sameJson(value, from) ? 'will change' : 'skipped: admin changed';
}

export async function fb07DryRun(db: DbOrTx): Promise<Fb07DryRunReport> {
  const open = await rows<{
    quote_number: string;
    status: string;
    version: number;
    pricer: string | null;
    costing_completed: boolean | null;
    costing_attested_at: Date | null;
    has_model: boolean;
  }>(
    db,
    sql`select q.quote_number, q.status, q.version, u.display_name as pricer,
          pr.costing_completed, pr.costing_attested_at,
          exists (select 1 from attachment a
                  where a.quote_id = q.id and a.kind = 'cost_model' and a.removed_at is null) as has_model
        from quote q
        left join pricing_record pr on pr.quote_id = q.id and pr.quote_version = q.version
        left join app_user u on u.id = q.assigned_pricer_id
        where q.stage_key = 'QUOTING' and q.status <> 'closed'
        order by q.quote_number`,
  );
  const toRow = (r: (typeof open)[number]): OpenQuoteRow => ({
    quoteNumber: r.quote_number,
    status: r.status,
    version: r.version,
    pricer: r.pricer,
    costingAttestedAt: r.costing_attested_at ? new Date(r.costing_attested_at).toISOString() : null,
  });

  const [gate] = await rows<{ label: string; approved_at: Date | null }>(
    db,
    sql`select label, approved_at from gate_definition where key = 'G3'`,
  );
  const [outcome] = await rows<{
    label: string;
    help_text: string | null;
    required_fields: unknown;
    approved_at: Date | null;
  }>(
    db,
    sql`select label, help_text, required_fields, approved_at
        from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`,
  );
  const [setting] = await rows<{ value: unknown }>(
    db,
    sql`select value from app_setting where key = 'roi_required_when'`,
  );
  const grants = await rows<{ role: string; permission: string }>(
    db,
    sql`select role, permission from role_permission
        where (role = 'Finance') or permission = 'roi.upload'`,
  );
  const newRule = [...FB07.seededRule, ...FB07.addedRules];
  const helpOutcome: ConfigOutcome = !outcome
    ? 'missing'
    : outcome.help_text === FB07.outcomeHelp.from
      ? outcome.approved_at
        ? 'skipped: approved'
        : 'will change'
      : outcome.help_text?.startsWith('The pricing lead confirms the price.')
        ? 'already done'
        : outcome.approved_at
          ? 'skipped: approved'
          : 'skipped: admin changed';

  return {
    grandfathered: open.filter((r) => r.costing_completed && !r.has_model).map(toRow),
    needModel: open.filter((r) => !r.costing_completed && !r.has_model).map(toRow),
    config: [
      {
        item: 'G3 gate label → "Price approved"',
        current: gate?.label ?? null,
        outcome: outcomeFor(gate, gate?.label, FB07.gateLabel.from, FB07.gateLabel.to),
      },
      {
        item: 'G3 Advance label → "Advance – price approved"',
        current: outcome?.label ?? null,
        outcome: outcomeFor(outcome, outcome?.label, FB07.outcomeLabel.from, FB07.outcomeLabel.to),
      },
      { item: 'G3 Advance help text', current: outcome?.help_text ?? null, outcome: helpOutcome },
      {
        item: 'G3 Advance rule + costing model + ROI model',
        current: outcome ? JSON.stringify(outcome.required_fields) : null,
        outcome: outcomeFor(outcome, outcome?.required_fields, FB07.seededRule, newRule),
      },
      {
        item: 'app_setting roi_required_when (provisional)',
        current: setting ? JSON.stringify(setting.value) : null,
        outcome: setting ? 'already done' : 'will change',
      },
      {
        item: 'role_permission: Finance (3 rows) + roi.upload for PricingLead and Admin',
        current: grants.map((g) => `${g.role}:${g.permission}`).join(', ') || null,
        outcome: grants.length >= 5 ? 'already done' : 'will change',
      },
    ],
  };
}

/** The report as Markdown (quote numbers and pricer names only: no customer names, no figures). */
export function renderFb07DryRun(report: Fb07DryRunReport, at: Date): string {
  const table = (list: OpenQuoteRow[]) =>
    list.length === 0
      ? '_None._\n'
      : [
          '| Quote | Status | Version | Pricer | Costing attested (UTC) |',
          '|---|---|---|---|---|',
          ...list.map(
            (r) =>
              `| ${r.quoteNumber} | ${r.status} | ${r.version} | ${r.pricer ?? '–'} | ${r.costingAttestedAt ?? '–'} |`,
          ),
          '',
        ].join('\n');
  return [
    `# FB-07 dry run (migration 0031), ${at.toISOString()}`,
    '',
    `## Grandfathered: ${report.grandfathered.length} quote(s)`,
    '',
    'In Quoting with costing attested and no costing model on file. They keep working: the Quoting tab shows "no model on file" and G3 does not ask for the model on this version.',
    '',
    table(report.grandfathered),
    `## Need a costing model: ${report.needModel.length} quote(s)`,
    '',
    'In Quoting with costing not yet attested. Pricing uploads the costing model before attesting costing; the pricing lead cannot approve the price without it.',
    '',
    table(report.needModel),
    '## Config',
    '',
    '| Item | Now | Outcome |',
    '|---|---|---|',
    ...report.config.map(
      (c) =>
        `| ${c.item} | ${(c.current ?? '–').replace(/\|/g, '\\|').slice(0, 120)} | ${c.outcome} |`,
    ),
    '',
  ].join('\n');
}
