import type {
  AuditEventDto,
  AuditExportQuery,
  AuditListResponse,
  AuditQuery,
  UsageReportQuery,
  UsageReportResponse,
} from '@ccq/contracts';
import { AUDIT_PROBLEM_CODES } from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  getQuoteByNumber,
  searchAuditEvents,
  usageReport,
  type AuditSearch,
  type AuditSearchRow,
} from '@ccq/db/repos';
import { assertCan, type Actor } from '@ccq/domain';

import { decodeCursor, page } from './cursor';
import { ServiceProblem } from './problem';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type AuditWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Report and filter days are calendar days at Pretium HQ (US Central, CLAUDE.md "Time"). */
export const REPORT_TIME_ZONE = 'America/Chicago';
/** The CSV export is capped; narrow the filters for more. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const MAX_REPORT_DAYS = 366;
const DAY_MS = 86_400_000;

/** UTC offset of `timeZone` at `at`, in ms (positive east of UTC). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a calendar day (`YYYY-MM-DD`) starts in `timeZone`. */
export function startOfDay(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  // A second pass settles days whose midnight sits across a DST change from the guess.
  return new Date(guess.getTime() - zoneOffsetMs(first, timeZone));
}

/** Today's date (`YYYY-MM-DD`) in `timeZone`. */
export const dayIn = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function dto(r: AuditSearchRow): AuditEventDto {
  const e = r.event;
  return {
    id: e.id,
    at: e.at.toISOString(),
    actorId: e.actorId,
    actorName: r.actorName ?? null,
    actorUpn: r.actorUpn ?? null,
    actorRoles: e.actorRoles,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    quoteId: e.quoteId,
    quoteNumber: r.quoteNumber ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    changeReason: e.changeReason,
    ip: e.ip,
    userAgent: e.userAgent,
    requestId: e.requestId,
  };
}

/** A CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised (spreadsheet formula injection). */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: [header: string, get: (e: AuditEventDto) => unknown][] = [
  ['at_utc', (e) => e.at],
  ['actor', (e) => e.actorName],
  ['actor_upn', (e) => e.actorUpn],
  ['actor_roles', (e) => e.actorRoles.join(' ')],
  ['action', (e) => e.action],
  ['entity', (e) => e.entity],
  ['entity_id', (e) => e.entityId],
  ['quote_number', (e) => e.quoteNumber],
  ['before', (e) => e.before],
  ['after', (e) => e.after],
  ['ip', (e) => e.ip],
  ['user_agent', (e) => e.userAgent],
  ['request_id', (e) => e.requestId],
];

/**
 * The usage audit log for Leadership and Admin (F-12): the filterable viewer, its CSV export (itself
 * audited as an `export`) and the adoption report (PRD 8.2). RLS lets only Leadership/Admin read
 * every row; the route requires `audit.read`.
 */
export class AuditAdminService {
  private readonly now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  private async search(
    tx: Tx,
    q: AuditExportQuery,
    extra: Pick<AuditSearch, 'before' | 'limit'>,
  ): Promise<AuditSearchRow[] | null> {
    let quoteId: string | undefined;
    if (q.quoteNumber) {
      const quote = await getQuoteByNumber(tx, q.quoteNumber);
      if (!quote) return null;
      quoteId = quote.id;
    }
    if (q.from && q.to && q.from > q.to) {
      throw new ServiceProblem(400, AUDIT_PROBLEM_CODES.badRange, '`from` is after `to`');
    }
    return searchAuditEvents(tx, {
      actorId: q.actorId,
      quoteId,
      action: q.action,
      from: q.from ? startOfDay(q.from, REPORT_TIME_ZONE) : undefined,
      to: q.to ? startOfDay(addDays(q.to, 1), REPORT_TIME_ZONE) : undefined,
      ...extra,
    });
  }

  async list(withTx: AuditWithTx, query: AuditQuery): Promise<AuditListResponse> {
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (before === null) {
      throw new ServiceProblem(400, AUDIT_PROBLEM_CODES.badCursor, 'The cursor is not valid');
    }
    return withTx(async (tx) => {
      const rows = await this.search(tx, query, { before, limit: query.limit + 1 });
      if (!rows) return { items: [], nextCursor: null };
      const { items, nextCursor } = page(rows, query.limit, (r) => ({
        at: r.event.at,
        id: r.event.id,
      }));
      return { items: items.map(dto), nextCursor };
    });
  }

  /** CSV of the filtered log (newest first, capped). The export itself is an audit row. */
  async exportCsv(
    withTx: AuditWithTx,
    actor: Actor,
    query: AuditExportQuery,
    meta: AuditMeta,
  ): Promise<{ csv: string; rows: number; truncated: boolean }> {
    assertCan(actor, 'export.csv');
    const at = this.now();
    return withTx(async (tx) => {
      const rows = (await this.search(tx, query, { limit: AUDIT_EXPORT_MAX_ROWS + 1 })) ?? [];
      const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
      const items = rows.slice(0, AUDIT_EXPORT_MAX_ROWS).map(dto);
      const lines = [
        CSV_COLUMNS.map(([h]) => h).join(','),
        ...items.map((e) => CSV_COLUMNS.map(([, get]) => csvCell(get(e))).join(',')),
      ];
      await recordAudit(tx, actor, meta, {
        at,
        action: 'export',
        entity: 'audit_event',
        after: { format: 'csv', filters: query, rows: items.length, truncated },
      });
      return { csv: `${lines.join('\r\n')}\r\n`, rows: items.length, truncated };
    });
  }

  /** Adoption from the audit log: daily active users by role, quotes viewed, actions by type. */
  async usage(withTx: AuditWithTx, query: UsageReportQuery): Promise<UsageReportResponse> {
    const today = dayIn(this.now(), REPORT_TIME_ZONE);
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -29);
    if (from > to)
      throw new ServiceProblem(400, AUDIT_PROBLEM_CODES.badRange, '`from` is after `to`');
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_REPORT_DAYS) {
      throw new ServiceProblem(
        400,
        AUDIT_PROBLEM_CODES.badRange,
        'The range is longer than a year',
      );
    }
    return withTx(async (tx) => ({
      from,
      to,
      timeZone: REPORT_TIME_ZONE,
      ...(await usageReport(
        tx,
        startOfDay(from, REPORT_TIME_ZONE),
        startOfDay(addDays(to, 1), REPORT_TIME_ZONE),
        REPORT_TIME_ZONE,
      )),
    }));
  }
}
