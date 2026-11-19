import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  JOURNAL_PATH,
  UsageError,
  checkJournal,
  exportTree,
  largestWhenEverMerged,
  parseArgs,
  readBlobs,
  resolveRef,
} from './release-upgrade-check';
import type { JournalEntry } from './release-upgrade-check';

const entry = (idx: number, when: number, name = `m${idx}`): JournalEntry => ({
  idx,
  when,
  tag: `${String(idx).padStart(4, '0')}_${name}`,
});

describe('checkJournal (the branch journal against the base)', () => {
  const base = [entry(0, 100), entry(1, 200), entry(2, 300)];

  it('passes a branch that adds nothing', () => {
    expect(checkJournal(base, base, 300)).toEqual({ added: [], failures: [], notes: [] });
  });

  it('passes new entries numbered on and above the floor', () => {
    const branch = [...base, entry(3, 401), entry(4, 402)];
    const result = checkJournal(base, branch, 400);
    expect(result.failures).toEqual([]);
    expect(result.added.map((e) => e.tag)).toEqual(['0003_m3', '0004_m4']);
  });

  it('names a `when` below the base newest (the 2026-11-19 outage) and says what to use', () => {
    const [failure, ...rest] = checkJournal(
      base,
      [...base, entry(3, 250)],
      300,
      'origin/main',
    ).failures;
    expect(rest).toEqual([]);
    expect(failure).toContain('`0003_m3` has `when` 250, not above 300');
    expect(failure).toContain('ever merged to origin/main');
    expect(failure).toContain('use number 0003 (idx 3) and `when` 301');
  });

  it('holds new entries above a `when` merged and later reverted (the floor), not only the journal', () => {
    // The base journal ends at 300, but 350 was merged once and reverted.
    const { failures } = checkJournal(base, [...base, entry(3, 320)], 350);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('not above 350');
    expect(failures[0]).toContain('`when` 351');
  });

  it('names a repeated idx', () => {
    const dup = { idx: 2, when: 301, tag: '0002_dup' };
    const { failures } = checkJournal(base, [...base, dup], 300);
    expect(failures).toEqual([
      '`0002_dup` has idx 2, but the entry before it (`0002_m2`) has idx 2: use number 0003 (idx 3) and `when` 301.',
    ]);
  });

  it('names a tag number that does not match idx', () => {
    const { failures } = checkJournal(base, [...base, { idx: 3, when: 301, tag: '0007_x' }], 300);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('`0007_x` has idx 3 but its tag number is 0007');
  });

  it('names a second new entry that is not after the first', () => {
    const { failures } = checkJournal(base, [...base, entry(3, 302), entry(4, 301)], 300);
    expect(failures).toEqual([
      expect.stringContaining("`0004_m4` has `when` 301, not above `0003_m3`'s 302"),
    ]);
  });

  it('asks for a rebase when the base has a migration the branch lacks', () => {
    const ahead = [...base, entry(3, 400, 'theirs')];
    const { failures } = checkJournal(ahead, [...base, entry(3, 401, 'mine')], 400, 'origin/main');
    expect(failures[0]).toContain('`0003_theirs` is on origin/main but not in this branch');
    expect(failures[0]).toContain('rebase onto origin/main');
  });

  it('notes, without failing, a merged migration whose `when` the branch changed', () => {
    const moved = [entry(0, 100), entry(1, 200), entry(2, 301)];
    const result = checkJournal(base, moved, 300);
    expect(result.failures).toEqual([]);
    expect(result.notes[0]).toContain('`0002_m2` changes its merged `when`');
  });
});

describe('parseArgs', () => {
  it('defaults to origin/main with the API and 60 seconds', () => {
    expect(parseArgs([])).toEqual({ base: 'origin/main', api: true, timeoutSeconds: 60 });
  });

  it('reads --base, --base=, --no-api, --timeout and ignores pnpm’s --', () => {
    expect(parseArgs(['--', '--base', 'origin/release', '--no-api', '--timeout', '90'])).toEqual({
      base: 'origin/release',
      api: false,
      timeoutSeconds: 90,
    });
    expect(parseArgs(['--base=abc123']).base).toBe('abc123');
  });

  it('refuses unknown arguments and missing values as usage errors', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['--base'])).toThrow(UsageError);
    expect(() => parseArgs(['--timeout', '0'])).toThrow(UsageError);
  });
});

describe('reading the base from git', () => {
  let repo: string;
  let out: string;
  const g = (...args: string[]) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const writeJournal = (whens: number[]) => {
    const file = join(repo, JOURNAL_PATH);
    mkdirSync(join(file, '..'), { recursive: true });
    const entries = whens.map((when, idx) => entry(idx, when));
    writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`);
    for (const e of entries) {
      writeFileSync(join(repo, 'packages/db/migrations', `${e.tag}.sql`), `select ${e.idx};\n`);
    }
  };
  const commit = (message: string) => {
    g('add', '-A');
    g('commit', '-q', '-m', message);
    return g('rev-parse', 'HEAD');
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'ccq-upgrade-git-'));
    out = mkdtempSync(join(tmpdir(), 'ccq-upgrade-out-'));
    g('init', '-q', '-b', 'main');
    g('config', 'core.autocrlf', 'false');
    writeJournal([100, 200]);
    commit('two migrations');

    // A pull request whose first commit had a hand-set future `when`, fixed before it merged.
    g('switch', '-q', '-c', 'feature');
    writeJournal([100, 200, 999]);
    commit('generate (future when)');
    writeJournal([100, 200, 300]);
    commit('fix when');
    g('switch', '-q', 'main');
    g('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');

    // A migration merged, then reverted: a database that ran it keeps it.
    writeJournal([100, 200, 300, 400]);
    commit('add 400');
    g('revert', '--no-edit', 'HEAD');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('takes the largest `when` ever on the first-parent line: reverted counts, PR drafts do not', () => {
    expect(largestWhenEverMerged(repo, 'main')).toBe(400);
    expect(largestWhenEverMerged(repo, 'main~1')).toBe(400); // the commit that added 400
    expect(largestWhenEverMerged(repo, 'main~2')).toBe(300); // the merge, before 400
  });

  it('exports the base migrations folder as it is at the ref', () => {
    const n = exportTree(repo, 'main', ['packages/db/migrations'], out);
    expect(n).toBe(4); // the journal and three SQL files: the revert removed the fourth
  });

  it('reads blobs in one batch and maps a missing one to undefined', () => {
    const [journal, missing] = readBlobs(repo, [`main:${JOURNAL_PATH}`, 'main:no/such/file']);
    expect((JSON.parse(journal!.toString('utf8')) as { entries: unknown[] }).entries).toHaveLength(
      3,
    );
    expect(missing).toBeUndefined();
  });

  it('refuses an unknown base ref as a usage error naming it', () => {
    expect(() => resolveRef(repo, 'origin/nope')).toThrow(/`origin\/nope` is not a commit here/);
  });

  it('writes the exported journal byte for byte', () => {
    const exported = readFileSync(join(out, JOURNAL_PATH), 'utf8');
    expect(exported).toBe(g('show', `main:${JOURNAL_PATH}`) + '\n');
  });
});
