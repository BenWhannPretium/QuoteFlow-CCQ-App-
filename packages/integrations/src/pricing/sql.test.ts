import { describe, expect, it, vi } from 'vitest';

import { PRICING_COLUMNS, PRICING_OBJECTS } from './columnMap';
import { syntheticPricingFixture } from './fixtures';
import { PricingTimeoutError, pricingErrorCode, type PricingLogger } from './reader';
import {
  PricingColumnMissingError,
  PricingWriteRefusedError,
  SqlPricingReader,
  assertSelectOnly,
  containsPattern,
  erfSearch,
  type SqlQueryRunner,
  type SqlStatement,
} from './sql';

const C = PRICING_COLUMNS;
const objects = PRICING_OBJECTS.sqlserver;

/**
 * A runner that answers INFORMATION_SCHEMA with the mapped columns (minus `missing`) and every other
 * statement with `rows`, recording what it was sent.
 */
function fakeRunner(rows: Record<string, unknown>[] = [], missing: string[] = []) {
  const sent: SqlStatement[] = [];
  const runner: SqlQueryRunner & { sent: SqlStatement[] } = {
    sent,
    query: vi.fn((statement: SqlStatement) => {
      sent.push(statement);
      if (statement.text.includes('INFORMATION_SCHEMA')) {
        const table = statement.params.find((p) => p.name === 'table')!.value;
        const object = (Object.keys(objects) as (keyof typeof objects)[]).find((k) =>
          objects[k].endsWith(`.${String(table)}`),
        )!;
        return Promise.resolve(
          Object.values(C[object])
            .map((r) => r.column)
            .filter((c) => !missing.includes(c))
            .map((c) => ({ COLUMN_NAME: c })),
        );
      }
      return Promise.resolve(rows);
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  return runner;
}

const logger = () => {
  const lines: unknown[] = [];
  const log: PricingLogger = {
    info: (o, m) => lines.push([o, m]),
    warn: (o, m) => lines.push([o, m]),
    error: (o, m) => lines.push([o, m]),
  };
  return { lines, log };
};

const fixture = syntheticPricingFixture();
const erfRow = fixture.erf[0]!;
const INJECTION = "26367'; DROP TABLE ERF; --";

describe('read-only guard', () => {
  it('allows one SELECT', () => {
    expect(() =>
      assertSelectOnly('SELECT TOP (@top) [A] FROM [ccq].[v_ERF] WHERE [A] = @a'),
    ).not.toThrow();
    expect(() => assertSelectOnly('select [Date_Set], [Updated_By] from [x].[y]')).not.toThrow();
  });

  it.each([
    'UPDATE [ccq].[v_ERF] SET [A] = 1',
    'DELETE FROM x',
    'INSERT INTO x VALUES (1)',
    'SELECT * INTO new_table FROM x',
    'SELECT 1; DROP TABLE x',
    'SELECT 1 -- comment',
    'SELECT 1 /* c */',
    'EXEC sp_who',
    'SELECT 1 FROM x WHERE 1 = 1 MERGE y',
    "SELECT * FROM OPENROWSET('x')",
    "SELECT 1 WAITFOR DELAY '0:0:5'",
    'WITH c AS (SELECT 1) DELETE FROM c',
  ])('refuses %s', (text) => {
    expect(() => assertSelectOnly(text)).toThrow(PricingWriteRefusedError);
  });
});

describe('SQL statements are parameterized and capped', () => {
  it('never splices a value into the text', async () => {
    const runner = fakeRunner([]);
    const reader = new SqlPricingReader(runner, { mode: 'sqlserver', objects });
    await reader.getErf(INJECTION);
    await reader.getBpr(INJECTION);
    await reader.findBprsForErf(INJECTION);
    await reader.findErfs({
      customerName: INJECTION,
      text: INJECTION,
      sfOpportunityId: INJECTION,
      limit: 10,
    });
    await reader.getSprHistory({ customerName: INJECTION, itemText: INJECTION });
    const queries = runner.sent.filter((s) => !s.text.includes('INFORMATION_SCHEMA'));
    expect(queries).toHaveLength(5);
    for (const s of queries) {
      expect(s.text).not.toContain('DROP');
      expect(s.text).not.toContain('26367');
      expect(s.text).toMatch(/^SELECT TOP \(@top\) /);
      expect(s.params.some((p) => String(p.value).includes('DROP TABLE'))).toBe(true);
    }
  });

  it('caps every query at 50 rows, whatever the caller asks', async () => {
    const runner = fakeRunner([]);
    const reader = new SqlPricingReader(runner, { mode: 'sqlserver', objects });
    await reader.findErfs({ text: 'acme', limit: 5_000 });
    await reader.findBprsForErf('26367');
    await reader.getSprHistory({ customerName: 'acme' });
    const tops = runner.sent
      .filter((s) => !s.text.includes('INFORMATION_SCHEMA'))
      .map((s) => s.params.find((p) => p.name === 'top')!.value);
    expect(tops).toEqual([50, 50, 50]);
    await reader.findErfs({ text: 'acme', limit: 7 });
    expect(runner.sent.at(-1)!.params.find((p) => p.name === 'top')!.value).toBe(7);
  });

  it('escapes LIKE wildcards in search text', () => {
    expect(containsPattern(' 50%_off[1] ')).toBe('%50[%][_]off[[]1]%');
  });

  it('looks an ERF up by the typed value and its prefix-free form', async () => {
    const runner = fakeRunner([erfRow]);
    const reader = new SqlPricingReader(runner, { mode: 'sqlserver', objects });
    const erf = await reader.getErf('erf-26367');
    expect(erf?.erfNumber).toBe(String(erfRow[C.erf.erfNumber.column]));
    const s = runner.sent.at(-1)!;
    expect(s.text).toContain('CONVERT(nvarchar(40), [ERF_Number]) IN (@key, @raw)');
    expect(s.params).toEqual(
      expect.arrayContaining([
        { name: 'key', type: 'nvarchar', value: '26367' },
        { name: 'raw', type: 'nvarchar', value: 'erf-26367' },
        { name: 'top', type: 'int', value: 1 },
      ]),
    );
    expect(s.text).toContain('FROM [ccq].[v_ERF]');
  });

  it('an unfiltered search sends nothing', async () => {
    const runner = fakeRunner([]);
    const reader = new SqlPricingReader(runner, { mode: 'sqlserver', objects });
    expect(await reader.findErfs({ text: '  ', limit: 10 })).toEqual([]);
    expect(await reader.getSprHistory({})).toEqual([]);
    expect(runner.sent.filter((s) => !s.text.includes('INFORMATION_SCHEMA'))).toEqual([]);
  });

  it('a filter on a column the view lacks returns nothing instead of being ignored', () => {
    const resolved = { ...C.erf, customerName: null } as Record<
      string,
      (typeof C.erf)['erfNumber'] | null
    >;
    expect(erfSearch(objects.erf, resolved, { customerName: 'acme', limit: 5 })).toBeNull();
    expect(erfSearch(objects.erf, resolved, { text: 'acme', limit: 5 })!.text).not.toContain(
      '[Customer_Name]',
    );
  });
});

describe('SqlPricingReader', () => {
  it('checks the view columns once, maps missing optional columns to null and logs names only', async () => {
    const { lines, log } = logger();
    const runner = fakeRunner([erfRow], ['Est_Revenue', 'Channel']);
    const reader = new SqlPricingReader(runner, { mode: 'fabric', objects, logger: log });
    const first = await reader.getErf('26367');
    await reader.getErf('26367');
    expect(runner.sent.filter((s) => s.text.includes('INFORMATION_SCHEMA'))).toHaveLength(1);
    const select = runner.sent.find((s) => s.text.includes('v_ERF'))!.text;
    expect(select).not.toContain('[Est_Revenue]');
    expect(select).not.toContain('[Channel]');
    expect(first).not.toBeNull();
    expect(lines).toEqual([
      [{ object: 'erf', columns: ['Channel', 'Est_Revenue'] }, expect.any(String)],
    ]);
    expect(reader.mode).toBe('fabric');
  });

  it('a view without its key column fails every call with COLUMN_MISSING', async () => {
    const reader = new SqlPricingReader(fakeRunner([], ['BPR_Number']), {
      mode: 'sqlserver',
      objects,
    });
    const err = await reader.getBpr('BPR-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PricingColumnMissingError);
    expect(pricingErrorCode(err)).toBe('COLUMN_MISSING');
  });

  it('times out after the configured limit (10 s by default)', async () => {
    const runner: SqlQueryRunner = {
      query: () => new Promise(() => {}),
      close: () => Promise.resolve(),
    };
    const { lines, log } = logger();
    const reader = new SqlPricingReader(runner, {
      mode: 'sqlserver',
      objects,
      timeoutMs: 20,
      logger: log,
    });
    const err = await reader.getErf('26367').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PricingTimeoutError);
    expect(pricingErrorCode(err)).toBe('ETIMEOUT');
    expect(lines).toEqual([[{ op: 'columns:erf', code: 'ETIMEOUT' }, 'pricing app query failed']]);
  });

  it('logs a failed query with its code only: never the message, values or rows', async () => {
    const secret = 'Acme Bottling (synthetic) 26367';
    const runner = fakeRunner([erfRow]);
    const reader = new SqlPricingReader(
      {
        query: (s) =>
          s.text.includes('INFORMATION_SCHEMA')
            ? runner.query(s)
            : Promise.reject(
                Object.assign(new Error(`Conversion failed for '${secret}'`), { code: 'EREQUEST' }),
              ),
        close: () => Promise.resolve(),
      },
      { mode: 'sqlserver', objects, logger: logger().log },
    );
    const { lines, log } = logger();
    Object.assign(reader, { logger: log });
    await expect(reader.getErf(secret)).rejects.toThrow();
    expect(JSON.stringify(lines)).not.toContain('Acme');
    expect(JSON.stringify(lines)).not.toContain('26367');
    expect(lines).toEqual([[{ op: 'getErf', code: 'EREQUEST' }, 'pricing app query failed']]);
  });

  it('reports every mapped column the views lack (live contract test helper)', async () => {
    const reader = new SqlPricingReader(fakeRunner([], ['Est_Volume', 'Status']), {
      mode: 'sqlserver',
      objects,
    });
    expect(await reader.unresolvedColumns()).toEqual([
      'erf.Est_Volume',
      'bpr.Status',
      'spr.Status',
    ]);
  });
});
