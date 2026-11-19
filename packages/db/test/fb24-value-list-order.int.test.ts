import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { testDb } from './helpers';
import { listAllValueLists } from '../src/repos/admin-config';
import { listActiveValueLists, listValueList } from '../src/repos/config';

const { db } = testDb();

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe('FB-24 (N17-08): value lists are read A to Z, Other last, unless the list keeps its order', () => {
  afterAll(async () => {
    await db.execute(
      sql`update value_list set sort = 70 where list_key = 'requested_payment_terms' and code = 'OTHER'`,
    );
  });

  it('a list is A to Z (numeric-aware) with Other last, whatever its stored sort', async () => {
    // Other stored first: still read last.
    await db.execute(
      sql`update value_list set sort = 1 where list_key = 'requested_payment_terms' and code = 'OTHER'`,
    );
    expect(labels(await listValueList(db, 'requested_payment_terms'))).toEqual([
      'Net 15',
      'Net 30',
      'Net 45',
      'Net 60',
      'Net 90',
      'Net 120',
      'Other',
    ]);
    const packaging = labels(await listValueList(db, 'packaging_type'));
    expect(packaging.at(-1)).toBe('Other');
    expect(packaging.slice(0, -1)).toEqual(
      [...packaging.slice(0, -1)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('a list whose entries say keepOrder stays in the stored order', async () => {
    expect((await listValueList(db, 'drawing_status')).map((r) => r.code)).toEqual([
      'HAVE_DRAWING',
      'COMING',
      'SAMPLE_ONLY',
      'NONE',
    ]);
  });

  it('the config bootstrap groups by list, each list in display order', async () => {
    const rows = await listActiveValueLists(db);
    const keys = rows.map((r) => r.listKey);
    expect(keys).toEqual([...keys].sort());
    const additive = rows.filter((r) => r.listKey === 'additive').map((r) => r.code);
    expect(additive.at(-1)).toBe('OTHER');
    expect(additive.slice(0, 2)).toEqual(['ANTISTAT', 'BARRIER']);
  });

  it("Admin's list editor keeps the stored order", async () => {
    const additive = (await listAllValueLists(db))
      .filter((r) => r.listKey === 'additive')
      .map((r) => r.sort);
    expect(additive).toEqual([...additive].sort((a, b) => a - b));
  });
});
