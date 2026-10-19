import type { PricingBpr, PricingErf, PricingSpr } from '@ccq/contracts';

import {
  PRICING_COLUMNS,
  quoteColumn,
  quoteObject,
  resolveColumns,
  type ColumnRef,
  type PricingObject,
} from './columnMap';
import { mapBpr, mapErf, mapRows, mapSpr } from './mapper';
import {
  PRICING_MAX_RESULTS,
  PRICING_TIMEOUT_MS,
  clampLimit,
  hasErfFilter,
  pricingErrorCode,
  refKey,
  silentPricingLogger,
  withPricingTimeout,
  type FindErfsParams,
  type PricingLogger,
  type PricingReader,
  type SprHistoryParams,
} from './reader';

/**
 * The SQL readers (Route A: SQL Server views; Route B: the Fabric SQL analytics endpoint). Both speak
 * TDS, so they share the statements here and differ only in how `mssql.ts` connects.
 *
 * Every statement is a single parameterized SELECT. Values are always parameters; the only text spliced
 * into SQL is view and column names from columnMap.ts, each checked against a strict identifier pattern
 * (`quoteColumn` / `quoteObject`). `assertSelectOnly` re-checks every statement before it is sent.
 */

type Row = Record<string, unknown>;

export interface SqlParam {
  name: string;
  type: 'nvarchar' | 'int';
  value: string | number;
}

export interface SqlStatement {
  text: string;
  params: SqlParam[];
}

/** Runs one read-only statement. Rows are keyed by column name. */
export interface SqlQueryRunner {
  query(statement: SqlStatement): Promise<Row[]>;
  close(): Promise<void>;
}

export class PricingColumnMissingError extends Error {
  readonly code = 'COLUMN_MISSING';
  constructor(readonly columns: string[]) {
    // Column names only (they come from columnMap.ts, not from data).
    super(`Pricing-app view is missing required column(s): ${columns.join(', ')}`);
    this.name = 'PricingColumnMissingError';
  }
}

export class PricingWriteRefusedError extends Error {
  readonly code = 'WRITE_REFUSED';
  constructor() {
    super('Refused a non-SELECT statement: the pricing-app connector is read-only');
    this.name = 'PricingWriteRefusedError';
  }
}

const WRITE_WORDS =
  /\b(insert|update|delete|merge|exec|execute|drop|alter|create|truncate|grant|revoke|deny|into|openrowset|opendatasource|openquery|bulk|dbcc|waitfor|backup|restore|declare|set)\b/i;

/** Throws unless `text` is one SELECT statement with no write keyword, comment or batch separator. */
export function assertSelectOnly(text: string): void {
  // Bracketed identifiers can't hold these words in practice, but strip them so a column named
  // e.g. [Date_Set] can't trip the check and a crafted one can't hide a keyword.
  const outsideBrackets = text.replace(/\[[^\]]*\]/g, '[]');
  if (
    !/^\s*select\s/i.test(outsideBrackets) ||
    /;|--|\/\*/.test(outsideBrackets) ||
    WRITE_WORDS.test(outsideBrackets)
  ) {
    throw new PricingWriteRefusedError();
  }
}

/** `%text%` for LIKE with SQL Server's wildcards (`%`, `_`, `[`) escaped as `[x]`. */
export function containsPattern(text: string): string {
  return `%${text.trim().replace(/[[%_]/g, (ch) => `[${ch}]`)}%`;
}

type Resolved = Record<string, ColumnRef | null>;

/** The SELECT list: every resolved column of the map, once. */
export function selectList(resolved: Resolved): string {
  const columns = Object.values(resolved)
    .filter((ref): ref is ColumnRef => ref !== null)
    .map((ref) => quoteColumn(ref.column));
  return [...new Set(columns)].join(', ');
}

/** A key column compared as text, so an int key and a "ERF-123" style key both work. */
const keyText = (ref: ColumnRef) => `CONVERT(nvarchar(40), ${quoteColumn(ref.column)})`;

/** Exact lookup on a key column: matches the typed value or its prefix-free form. */
function byKey(
  view: string,
  resolved: Resolved,
  keyRef: ColumnRef,
  value: string,
  kind: 'erf' | 'bpr',
  orderBy: ColumnRef | null,
  top: number,
): SqlStatement {
  const raw = value.trim();
  const params: SqlParam[] = [
    { name: 'top', type: 'int', value: top },
    { name: 'key', type: 'nvarchar', value: refKey(raw, kind) },
    { name: 'raw', type: 'nvarchar', value: raw },
  ];
  const order = orderBy ? `${quoteColumn(orderBy.column)} DESC, ` : '';
  return {
    text:
      `SELECT TOP (@top) ${selectList(resolved)} FROM ${quoteObject(view)} ` +
      `WHERE ${keyText(keyRef)} IN (@key, @raw) ` +
      `ORDER BY ${order}${quoteColumn(keyRef.column)} DESC`,
    params,
  };
}

export const erfByNumber = (view: string, resolved: Resolved, erfNumber: string) =>
  byKey(view, resolved, PRICING_COLUMNS.erf.erfNumber, erfNumber, 'erf', null, 1);

export const bprByNumber = (view: string, resolved: Resolved, bprNumber: string) =>
  byKey(view, resolved, PRICING_COLUMNS.bpr.bprNumber, bprNumber, 'bpr', null, 1);

export const bprsForErf = (view: string, resolved: Resolved, erfNumber: string) =>
  byKey(
    view,
    resolved,
    PRICING_COLUMNS.bpr.erfNumber,
    erfNumber,
    'erf',
    resolved.requestedOn ?? null,
    PRICING_MAX_RESULTS,
  );

/**
 * ERF search: every filter given must match (customer contains, opportunity id equals, text in number /
 * title / customer). Null when a filter can't be applied because its column isn't in the view (the
 * caller returns no rows rather than ignoring the filter).
 */
export function erfSearch(
  view: string,
  resolved: Resolved,
  p: FindErfsParams,
): SqlStatement | null {
  const c = PRICING_COLUMNS.erf;
  const where: string[] = [];
  const params: SqlParam[] = [{ name: 'top', type: 'int', value: clampLimit(p.limit) }];
  if (p.customerName?.trim()) {
    if (!resolved.customerName) return null;
    where.push(`${quoteColumn(c.customerName.column)} LIKE @customer`);
    params.push({ name: 'customer', type: 'nvarchar', value: containsPattern(p.customerName) });
  }
  if (p.sfOpportunityId?.trim()) {
    if (!resolved.sfOpportunityId) return null;
    where.push(`${quoteColumn(c.sfOpportunityId.column)} = @opportunity`);
    params.push({ name: 'opportunity', type: 'nvarchar', value: p.sfOpportunityId.trim() });
  }
  if (p.text?.trim()) {
    const ors = [`${keyText(c.erfNumber)} LIKE @text`];
    if (resolved.title) ors.push(`${quoteColumn(c.title.column)} LIKE @text`);
    if (resolved.customerName) ors.push(`${quoteColumn(c.customerName.column)} LIKE @text`);
    where.push(`(${ors.join(' OR ')})`);
    params.push({ name: 'text', type: 'nvarchar', value: containsPattern(p.text) });
  }
  if (where.length === 0) return null;
  const order = resolved.submittedOn ? `${quoteColumn(c.submittedOn.column)} DESC, ` : '';
  return {
    text:
      `SELECT TOP (@top) ${selectList(resolved)} FROM ${quoteObject(view)} ` +
      `WHERE ${where.join(' AND ')} ORDER BY ${order}${quoteColumn(c.erfNumber.column)} DESC`,
    params,
  };
}

/** SPR history by customer and/or item text. Null without a usable filter. */
export function sprHistory(
  view: string,
  resolved: Resolved,
  p: SprHistoryParams,
): SqlStatement | null {
  const c = PRICING_COLUMNS.spr;
  const where: string[] = [];
  const params: SqlParam[] = [{ name: 'top', type: 'int', value: PRICING_MAX_RESULTS }];
  if (p.customerName?.trim()) {
    if (!resolved.customerName) return null;
    where.push(`${quoteColumn(c.customerName.column)} LIKE @customer`);
    params.push({ name: 'customer', type: 'nvarchar', value: containsPattern(p.customerName) });
  }
  if (p.itemText?.trim()) {
    if (!resolved.itemDescription) return null;
    where.push(`${quoteColumn(c.itemDescription.column)} LIKE @item`);
    params.push({ name: 'item', type: 'nvarchar', value: containsPattern(p.itemText) });
  }
  if (where.length === 0) return null;
  const order = resolved.requestedOn ? `${quoteColumn(c.requestedOn.column)} DESC, ` : '';
  return {
    text:
      `SELECT TOP (@top) ${selectList(resolved)} FROM ${quoteObject(view)} ` +
      `WHERE ${where.join(' AND ')} ORDER BY ${order}${quoteColumn(c.sprNumber.column)} DESC`,
    params,
  };
}

/** The view's column names (INFORMATION_SCHEMA works on SQL Server and the Fabric SQL endpoint). */
export function viewColumns(view: string): SqlStatement {
  quoteObject(view); // validates the name
  const [schema, table] = view.split('.') as [string, string];
  return {
    text:
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS ' +
      'WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table',
    params: [
      { name: 'schema', type: 'nvarchar', value: schema },
      { name: 'table', type: 'nvarchar', value: table },
    ],
  };
}

export interface SqlPricingReaderOptions {
  mode: 'sqlserver' | 'fabric';
  /** View per object (columnMap.ts `PRICING_OBJECTS[mode]` by default). */
  objects: Record<PricingObject, string>;
  logger?: PricingLogger;
  timeoutMs?: number;
}

/** PricingReader over a TDS connection (Route A or B). */
export class SqlPricingReader implements PricingReader {
  readonly mode: 'sqlserver' | 'fabric';
  private readonly logger: PricingLogger;
  private readonly timeoutMs: number;
  private readonly resolved = new Map<PricingObject, Resolved>();

  constructor(
    private readonly runner: SqlQueryRunner,
    private readonly options: SqlPricingReaderOptions,
  ) {
    this.mode = options.mode;
    this.logger = options.logger ?? silentPricingLogger;
    this.timeoutMs = options.timeoutMs ?? PRICING_TIMEOUT_MS;
  }

  private async run(op: string, statement: SqlStatement): Promise<Row[]> {
    assertSelectOnly(statement.text);
    try {
      return await withPricingTimeout(this.runner.query(statement), this.timeoutMs);
    } catch (err) {
      this.logger.warn({ op, code: pricingErrorCode(err) }, 'pricing app query failed');
      throw err;
    }
  }

  /** The object's mapped columns that exist, checked once per process (cached on success only). */
  private async columns(object: PricingObject): Promise<Resolved> {
    const hit = this.resolved.get(object);
    if (hit) return hit;
    const rows = await this.run(`columns:${object}`, viewColumns(this.options.objects[object]));
    const available = new Set(rows.map((r) => String(r.COLUMN_NAME)));
    const { resolved, missingRequired, dropped } = resolveColumns(
      PRICING_COLUMNS[object],
      available,
    );
    if (dropped.length > 0) {
      this.logger.warn({ object, columns: dropped }, 'pricing app view lacks mapped columns; null');
    }
    if (missingRequired.length > 0) throw new PricingColumnMissingError(missingRequired);
    this.resolved.set(object, resolved);
    return resolved;
  }

  /** Mapped columns missing from the views (for the live contract test). Column names only. */
  async unresolvedColumns(): Promise<string[]> {
    const out: string[] = [];
    for (const object of ['erf', 'bpr', 'spr'] as const) {
      const rows = await this.run(`columns:${object}`, viewColumns(this.options.objects[object]));
      const available = new Set(rows.map((r) => String(r.COLUMN_NAME)));
      const { missingRequired, dropped } = resolveColumns(PRICING_COLUMNS[object], available);
      out.push(...[...missingRequired, ...dropped].map((c) => `${object}.${c}`));
    }
    return out;
  }

  async getErf(erfNumber: string): Promise<PricingErf | null> {
    const resolved = await this.columns('erf');
    const rows = await this.run(
      'getErf',
      erfByNumber(this.options.objects.erf, resolved, erfNumber),
    );
    return mapRows(rows, mapErf)[0] ?? null;
  }

  async findErfs(params: FindErfsParams): Promise<PricingErf[]> {
    if (!hasErfFilter(params)) return [];
    const resolved = await this.columns('erf');
    const statement = erfSearch(this.options.objects.erf, resolved, params);
    if (!statement) return [];
    return mapRows(await this.run('findErfs', statement), mapErf).slice(
      0,
      clampLimit(params.limit),
    );
  }

  async getBpr(bprNumber: string): Promise<PricingBpr | null> {
    const resolved = await this.columns('bpr');
    const rows = await this.run(
      'getBpr',
      bprByNumber(this.options.objects.bpr, resolved, bprNumber),
    );
    return mapRows(rows, mapBpr)[0] ?? null;
  }

  async findBprsForErf(erfNumber: string): Promise<PricingBpr[]> {
    const resolved = await this.columns('bpr');
    const rows = await this.run(
      'findBprsForErf',
      bprsForErf(this.options.objects.bpr, resolved, erfNumber),
    );
    return mapRows(rows, mapBpr).slice(0, PRICING_MAX_RESULTS);
  }

  async getSprHistory(params: SprHistoryParams): Promise<PricingSpr[]> {
    const resolved = await this.columns('spr');
    const statement = sprHistory(this.options.objects.spr, resolved, params);
    if (!statement) return [];
    return mapRows(await this.run('getSprHistory', statement), mapSpr).slice(
      0,
      PRICING_MAX_RESULTS,
    );
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}
