import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from './migrate';

/**
 * Guard for the 2026-11-19 test outage. Drizzle's migrator applies a migration only when its journal
 * `when` is later than the `created_at` of the last migration the database has applied. A migration
 * whose `when` is not later than the one before it is skipped on every existing database, with no
 * error, and CI's empty database doesn't notice (it applies the whole journal in order). On test,
 * 0053 carried a hand-set future `when`, so 0054 and 0055 were skipped and start-up then failed on
 * a `COMMENT ON COLUMN` for a column 0054 should have added.
 *
 * When renumbering or rebasing a migration onto main, give it a `when` greater than every entry
 * before it (drizzle-kit writes `Date.now()`, which can be lower than a hand-set value).
 */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
  entries: JournalEntry[];
};

describe('migration journal', () => {
  it('has strictly increasing `when` timestamps, so no migration is skipped on an existing database', () => {
    const outOfOrder = journal.entries.slice(1).flatMap((entry, i) => {
      const previous = journal.entries[i]!;
      return entry.when > previous.when
        ? []
        : [
            `${entry.tag} (when ${entry.when}) is not after ${previous.tag} (when ${previous.when})`,
          ];
    });
    expect(outOfOrder).toEqual([]);
  });

  it('numbers the entries 0..n in order', () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('has one SQL file per entry and no SQL file without an entry', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    expect(files).toEqual(journal.entries.map((e) => e.tag).sort());
  });
});
