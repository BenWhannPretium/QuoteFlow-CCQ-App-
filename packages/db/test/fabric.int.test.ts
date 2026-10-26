import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { asPersona, persona, pgError, raw, testDb } from './helpers';
import {
  FABRIC_COMPANION_TRIGGER,
  FABRIC_JSON_COMPANIONS,
  FABRIC_SIDE_TABLES,
  fabricCompanionColumns,
  fabricCompanionName,
  isFabricMirroredType,
} from '../src/fabric';
import { uuidv7 } from '../src/ids';

/**
 * B-27 (L-8): the migrated, seeded database is mirror-safe for Fabric. The unit guard
 * (`fabricCompat.test.ts`) checks the Drizzle schema; this checks what the migrations actually built,
 * including the companions (which are not in Drizzle) and that every seeded row's companion is right.
 */
const { db } = testDb(2);

interface ColumnRow extends Record<string, unknown> {
  table_name: string;
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
}

const ROLLBACK = new Error('rollback');
/** Run `fn` as the owner in a transaction that is always rolled back. */
async function inRollback(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
) {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((err: unknown) => {
      if (err !== ROLLBACK) throw err;
    });
}

describe('Fabric mirror-safe database (B-27)', () => {
  it('every base-table column is mirrorable or has a text companion', async () => {
    const cols = await raw<ColumnRow>(
      db as never,
      sql`select c.table_name, c.column_name, c.data_type, c.numeric_precision
          from information_schema.columns c
          join information_schema.tables t using (table_schema, table_name)
          where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
    );
    const has = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
    const registered = new Map(
      fabricCompanionColumns().map((r) => [`${r.table}.${r.column}`, r.companionTable]),
    );
    const problems: string[] = [];
    for (const c of cols) {
      if (isFabricMirroredType(c.data_type, c.numeric_precision)) continue;
      const key = `${c.table_name}.${c.column_name}`;
      const companionTable = registered.get(key);
      const companion = companionTable
        ? has.get(`${companionTable}.${fabricCompanionName(c.column_name)}`)
        : undefined;
      if (companion?.data_type !== 'text') problems.push(`${key} (${c.data_type})`);
    }
    expect(problems, 'columns Fabric would drop, with no text companion').toEqual([]);
  });

  it('no partitioned tables, and every table has a primary key', async () => {
    const partitioned = await raw<{ relname: string }>(
      db as never,
      sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'p'`,
    );
    expect(partitioned).toEqual([]);
    const noPk = await raw<{ table_name: string }>(
      db as never,
      sql`select t.table_name from information_schema.tables t
          where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
            and not exists (select 1 from information_schema.table_constraints k
              where k.table_schema = 'public' and k.table_name = t.table_name
                and k.constraint_type = 'PRIMARY KEY')`,
    );
    expect(noPk).toEqual([]);
  });

  it('each table with companions has the companion trigger', async () => {
    const rows = await raw<{ table_name: string }>(
      db as never,
      sql`select c.relname as table_name from pg_trigger g join pg_class c on c.oid = g.tgrelid
          where g.tgname = ${FABRIC_COMPANION_TRIGGER} and not g.tgisinternal`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      Object.keys(FABRIC_JSON_COMPANIONS).sort(),
    );
  });

  it('every seeded row’s companion equals to_jsonb(column)::text', async () => {
    for (const [table, columns] of Object.entries(FABRIC_JSON_COMPANIONS)) {
      for (const column of columns) {
        const [row] = await raw<{ n: number }>(
          db as never,
          sql`select count(*)::int as n from ${sql.identifier(table)}
              where ${sql.identifier(fabricCompanionName(column))}
                is distinct from to_jsonb(${sql.identifier(column)})::text`,
        );
        expect(row!.n, `${table}.${column}`).toBe(0);
      }
    }
  });

  it('the companion follows inserts and updates, arrays as JSON arrays', async () => {
    await inRollback(async (tx) => {
      await raw(
        tx as never,
        sql`delete from user_scope where user_id = ${persona('kam-owner').id}`,
      );
      const [scope] = await raw<{ id: string; values_json: string }>(
        tx,
        sql`insert into user_scope (id, user_id, scope_type, values)
            values (${uuidv7()}, ${persona('kam-owner').id}, 'region', array['North', 'South'])
            returning id, values_json`,
      );
      expect(JSON.parse(scope!.values_json)).toEqual(['North', 'South']);
      const [updated] = await raw<{ values_json: string | null }>(
        tx,
        sql`update user_scope set values = array['West'] where id = ${scope!.id} returning values_json`,
      );
      expect(updated!.values_json).toBe('["West"]');
      // A stray write to the companion is overwritten from the source column.
      const [forced] = await raw<{ values_json: string }>(
        tx,
        sql`update user_scope set values_json = 'tampered' where id = ${scope!.id} returning values_json`,
      );
      expect(forced!.values_json).toBe('["West"]');
    });
  });

  it('a JSON null and an SQL null stay distinct', async () => {
    await inRollback(async (tx) => {
      const [row] = await raw<{ json_null: string | null; sql_null: string | null }>(
        tx,
        sql`with a as (
              update app_setting set value = 'null'::jsonb
              where key = (select key from app_setting limit 1) returning value_json)
            select (select value_json from a) as json_null, to_jsonb(null::jsonb)::text as sql_null`,
      );
      expect(row).toEqual({ json_null: 'null', sql_null: null });
    });
  });
});

describe('audit_event side table (B-27)', () => {
  const side = FABRIC_SIDE_TABLES.audit_event!;

  it('every audit row has its copies, equal to the source', async () => {
    const [row] = await raw<{ missing: number; wrong: number }>(
      db as never,
      sql`select
            count(*) filter (where f.audit_event_id is null)::int as missing,
            count(*) filter (where f.audit_event_id is not null and (
              f.actor_roles_json is distinct from to_jsonb(a.actor_roles)::text
              or f.before_json is distinct from to_jsonb(a.before)::text
              or f.after_json is distinct from to_jsonb(a.after)::text))::int as wrong
          from audit_event a left join ${sql.identifier(side.table)} f on f.audit_event_id = a.id`,
    );
    expect(row).toEqual({ missing: 0, wrong: 0 });
  });

  it('an audit insert by the app role writes its copy; the app role cannot read or change it', async () => {
    const id = uuidv7();
    await asPersona(db, 'kam-owner', async (tx) => {
      await raw(
        tx,
        sql`insert into audit_event (id, actor_id, actor_roles, action, entity, after)
            values (${id}, ${persona('kam-owner').id}, array['KAM'], 'view', 'quote', '{"tab":"summary"}')`,
      );
    });
    expect(
      await pgError(
        asPersona(db, 'admin', (tx) => raw(tx, sql`select * from audit_event_fabric limit 1`)),
      ),
    ).toBe('42501');
    const [copy] = await raw<{ actor_roles_json: string; after_json: string; before_json: null }>(
      db as never,
      sql`select actor_roles_json, after_json, before_json from audit_event_fabric
          where audit_event_id = ${id}`,
    );
    expect(copy).toEqual({
      actor_roles_json: '["KAM"]',
      after_json: '{"tab": "summary"}',
      before_json: null,
    });
    // Append-only, owner included.
    expect(
      await pgError(
        raw(db as never, sql`delete from audit_event_fabric where audit_event_id = ${id}`),
      ),
    ).toBe('42501');
  });
});
