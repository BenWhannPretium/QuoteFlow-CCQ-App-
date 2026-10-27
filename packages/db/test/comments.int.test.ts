import { describe, expect, it } from 'vitest';

import { testDb } from './helpers';
import { applyChangedComments } from '../src/migrate';

/**
 * B-27: migrations run on every start, so comments must be applied only when they change: a
 * `COMMENT ON` per column on each restart is needless DDL against tables Fabric mirrors.
 */
const client = testDb(1);

describe('table and column comments', () => {
  it('a migrated database needs no comment changes', async () => {
    expect(await applyChangedComments(client.sql)).toBe(0);
  });

  it('a changed comment is put back, and only that one', async () => {
    await client.sql.unsafe(`COMMENT ON COLUMN "quote"."quote_number" IS 'stale'`);
    expect(await applyChangedComments(client.sql)).toBe(1);
    expect(await applyChangedComments(client.sql)).toBe(0);
    const [row] = await client.sql<{ text: string }[]>`
      select col_description('quote'::regclass, a.attnum) as text
      from pg_attribute a where a.attrelid = 'quote'::regclass and a.attname = 'quote_number'`;
    expect(row!.text).not.toBe('stale');
  });
});
