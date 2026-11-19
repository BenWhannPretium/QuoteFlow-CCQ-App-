/**
 * FB-28 (BR-18): `pnpm release:upgrade-check`. Prove this branch's migrations apply on top of the
 * database the test site has, not only on an empty one, and that the API then starts.
 *
 * 1. Creates a new, randomly named database on the server in DATABASE_URL (dropped at the end).
 * 2. Applies the base ref's (default `origin/main`) migrations folder and analytics views to it with
 *    drizzle's own `migrate()`: **not** `runMigrations`, which would also apply this branch's
 *    `COMMENT ON` statements to a base-shaped schema and fail on any column the branch adds (42703).
 * 3. Runs this branch's `runMigrations` on the same database: nothing may be skipped.
 * 4. Checks the journal against the base: each new entry's `idx`, its tag number and its `when`,
 *    which must be above the largest `when` ever merged to the base (a reverted migration still
 *    counts: a revert does not un-apply it on a database that ran it).
 * 5. Starts the built API as the App Service does (`node apps/api/dist/azureStart.js`) on a free port
 *    and waits for `/api/v1/health` to report `"status":"ok"` and `"db":"up"`.
 *
 * Exit 0: passed (three lines say what was proved). 1: a check failed (one sentence per failure).
 * 2: usage or setup (no DATABASE_URL, unknown base ref, shallow clone, API not built).
 * See docs/build-guide/09-release-guards.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  ANALYTICS_SQL_DIR,
  MIGRATIONS_DIR,
  MigrationsNotAppliedError,
  analyticsSqlFiles,
  ensureRoleMembership,
  runMigrations,
} from '../migrate';

/** Repository paths the check reads at the base ref. */
export const MIGRATIONS_PATH = 'packages/db/migrations';
export const JOURNAL_PATH = `${MIGRATIONS_PATH}/meta/_journal.json`;
export const ANALYTICS_PATH = 'packages/db/sql/analytics';
/** The App Service entry point, relative to the repository root (scripts/package-azure.sh). */
export const API_ENTRY_PATH = 'apps/api/dist/azureStart.js';

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** A setup problem (exit 2), as opposed to a check that ran and failed (exit 1). */
export class UsageError extends Error {
  override name = 'UsageError';
}

export function readJournal(migrationsDir: string): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

// ---------------------------------------------------------------------------------------------
// The journal against the base
// ---------------------------------------------------------------------------------------------

export interface JournalCheck {
  /** Entries this branch adds after the base's, in order. */
  added: JournalEntry[];
  failures: string[];
  /** Worth saying, but not a failure. */
  notes: string[];
}

const pad = (n: number) => String(n).padStart(4, '0');

/**
 * Compare this branch's journal with the base's. `floor` is the largest `when` ever merged to the
 * base (see {@link largestWhenEverMerged}); every entry the branch adds must be above it.
 */
export function checkJournal(
  base: JournalEntry[],
  branch: JournalEntry[],
  floor: number,
  baseLabel = 'the base',
): JournalCheck {
  const failures: string[] = [];
  const notes: string[] = [];
  const branchTags = new Map(branch.map((e, i) => [e.tag, i]));
  const baseTags = new Set(base.map((e) => e.tag));

  base.forEach((entry, i) => {
    const at = branchTags.get(entry.tag);
    if (at === undefined) {
      failures.push(
        `\`${entry.tag}\` is on ${baseLabel} but not in this branch's journal: rebase onto ${baseLabel} and renumber this branch's migrations after it.`,
      );
    } else if (at !== i || branch[at]!.idx !== entry.idx) {
      failures.push(
        `\`${entry.tag}\` is entry ${entry.idx} on ${baseLabel} but entry ${branch[at]!.idx} at position ${at} here: never reorder a merged migration; put new ones after ${baseLabel}'s last.`,
      );
    } else if (branch[at]!.when !== entry.when) {
      notes.push(
        `\`${entry.tag}\` changes its merged \`when\` (${entry.when} on ${baseLabel}, ${branch[at]!.when} here); runMigrations realigns applied rows by hash, so this is allowed but should be deliberate.`,
      );
    }
  });

  const added = branch.filter((e) => !baseTags.has(e.tag));
  const lastBase = base.at(-1);
  const firstIdx = lastBase ? lastBase.idx + 1 : 0;
  const whenStart = Math.max(floor, lastBase?.when ?? 0);

  added.forEach((entry, k) => {
    const position = branchTags.get(entry.tag)!;
    if (position < base.length) {
      // Already reported above as a base entry out of place; say which new entry took its slot.
      failures.push(
        `\`${entry.tag}\` sits among ${baseLabel}'s migrations (position ${position}): move it after ${lastBase?.tag ?? 'the start'}.`,
      );
      return;
    }
    const previous = branch[position - 1];
    const wantIdx = firstIdx + k;
    const wantWhen = whenStart + 1 + k;
    const should = `use number ${pad(wantIdx)} (idx ${wantIdx}) and \`when\` ${wantWhen}`;
    const tagNumber = /^(\d{4})_/.exec(entry.tag)?.[1];

    if (previous && entry.idx !== previous.idx + 1) {
      failures.push(
        `\`${entry.tag}\` has idx ${entry.idx}, but the entry before it (\`${previous.tag}\`) has idx ${previous.idx}: ${should}.`,
      );
    } else if (!previous && entry.idx !== 0) {
      failures.push(`\`${entry.tag}\` is the first entry but has idx ${entry.idx}: ${should}.`);
    }
    if (tagNumber === undefined || Number(tagNumber) !== entry.idx) {
      failures.push(
        `\`${entry.tag}\` has idx ${entry.idx} but its tag number is ${tagNumber ?? 'missing'}: rename the SQL file, its snapshot and the tag together, and ${should}.`,
      );
    }
    if (entry.when <= floor) {
      failures.push(
        `\`${entry.tag}\` has \`when\` ${entry.when}, not above ${floor}, the largest \`when\` ever merged to ${baseLabel}: drizzle would skip it on the test database, so ${should}.`,
      );
    } else if (previous && entry.when <= previous.when) {
      failures.push(
        `\`${entry.tag}\` has \`when\` ${entry.when}, not above \`${previous.tag}\`'s ${previous.when}: drizzle would skip it on an existing database, so ${should}.`,
      );
    }
  });

  return { added, failures, notes };
}

// ---------------------------------------------------------------------------------------------
// Git: the base ref's files and history
// ---------------------------------------------------------------------------------------------

function git(repoRoot: string, args: string[], input?: string): Buffer {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new UsageError(`git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new UsageError(
      `git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim() || `exit ${result.status}`}`,
    );
  }
  return result.stdout;
}

const gitText = (repoRoot: string, args: string[]) => git(repoRoot, args).toString('utf8').trim();

export function repoRootOf(dir: string): string {
  return gitText(dir, ['rev-parse', '--show-toplevel']);
}

/** The commit a ref names, or a UsageError naming the ref. */
export function resolveRef(repoRoot: string, ref: string): string {
  try {
    return gitText(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new UsageError(
      `The base ref \`${ref}\` is not a commit here: run \`git fetch origin\`, or pass --base <ref>.`,
    );
  }
}

/**
 * Read many `<rev>:<path>` blobs with one `git cat-file --batch` (one process, not one per file:
 * that matters on Windows). A missing object maps to `undefined`.
 */
export function readBlobs(repoRoot: string, specs: string[]): (Buffer | undefined)[] {
  if (specs.length === 0) return [];
  const out = git(repoRoot, ['cat-file', '--batch'], specs.map((s) => `${s}\n`).join(''));
  const blobs: (Buffer | undefined)[] = [];
  let at = 0;
  for (let i = 0; i < specs.length; i++) {
    const eol = out.indexOf(0x0a, at);
    const header = out.subarray(at, eol).toString('utf8');
    at = eol + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      blobs.push(undefined);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    blobs.push(out.subarray(at, at + size));
    at += size + 1; // the content, then a newline
  }
  return blobs;
}

/** Write the files under `paths` at `ref` into `dest`, keeping their repository-relative layout. */
export function exportTree(repoRoot: string, ref: string, paths: string[], dest: string): number {
  const files = gitText(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', ...paths])
    .split('\n')
    .filter(Boolean);
  const blobs = readBlobs(
    repoRoot,
    files.map((f) => `${ref}:${f}`),
  );
  files.forEach((file, i) => {
    const target = join(dest, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, blobs[i]!);
  });
  return files.length;
}

/**
 * The largest journal `when` that was ever merged to `ref`: every version of `_journal.json` along
 * the ref's first-parent history (the states `main` itself has been in). A migration merged and later
 * reverted still counts, because the test database may have applied it. First-parent leaves out a
 * pull request's intermediate commits, which never reached a deployed database.
 */
export function largestWhenEverMerged(repoRoot: string, ref: string): number {
  const commits = gitText(repoRoot, ['rev-list', '--first-parent', ref, '--', JOURNAL_PATH])
    .split('\n')
    .filter(Boolean);
  let largest = 0;
  for (const blob of readBlobs(
    repoRoot,
    commits.map((c) => `${c}:${JOURNAL_PATH}`),
  )) {
    if (!blob) continue; // the commit that deleted the file, if any
    let entries: { when?: unknown }[] = [];
    try {
      entries =
        (JSON.parse(blob.toString('utf8')) as { entries?: { when?: unknown }[] }).entries ?? [];
    } catch {
      // A historical journal that did not parse (a conflict marker): read its `when`s as text.
      entries = [...blob.toString('utf8').matchAll(/"when"\s*:\s*(\d+)/g)].map((m) => ({
        when: Number(m[1]),
      }));
    }
    for (const e of entries) if (typeof e.when === 'number' && e.when > largest) largest = e.when;
  }
  return largest;
}

export function isShallow(repoRoot: string): boolean {
  return gitText(repoRoot, ['rev-parse', '--is-shallow-repository']) === 'true';
}

// ---------------------------------------------------------------------------------------------
// The database and the API
// ---------------------------------------------------------------------------------------------

export interface BaseMigrations {
  /** How the base is named in messages, e.g. `origin/main (c9ea359)`. */
  label: string;
  migrationsDir: string;
  /** The base's analytics views, applied after its migrations as its runMigrations would. */
  analyticsSqlDir?: string;
  /** The largest `when` ever merged to the base. */
  floor: number;
}

export interface ApiOptions {
  /** The entry to run with node, e.g. `<repo>/apps/api/dist/azureStart.js`. */
  entry: string;
  /** How the entry is named in messages. Default: the entry path. */
  label?: string;
  /** How long to wait for a healthy /api/v1/health. */
  timeoutMs?: number;
}

export interface UpgradeCheckOptions {
  /** A Postgres URL with rights to create and drop databases. */
  adminUrl: string;
  base: BaseMigrations;
  branchMigrationsDir?: string;
  branchAnalyticsSqlDir?: string;
  /** null: skip starting the API (`--no-api`). */
  api: ApiOptions | null;
  /** Fixed database name (tests). Default: `ccq_upgrade_<random>`. */
  databaseName?: string;
}

export interface UpgradeCheckResult {
  ok: boolean;
  failures: string[];
  notes: string[];
  /** What was proved, one line per stage. */
  proved: string[];
  databaseName: string;
}

const quiet = { max: 1, onnotice: () => {} } as const;

function withDatabase(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  while (e && typeof e === 'object') {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function describeError(err: unknown): string {
  const code = pgCode(err);
  const message = err instanceof Error ? err.message : String(err);
  return `${code ? `${code} ` : ''}${message.split('\n')[0]}`;
}

async function appliedHashes(url: string): Promise<Set<string>> {
  const sql = postgres(url, quiet);
  try {
    const [table] = await sql<{ exists: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
    if (!table?.exists) return new Set();
    const rows = await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations`;
    return new Set(rows.map((r) => r.hash));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * After drizzle's migrator failed (it runs every pending migration in one transaction, and its error
 * does not say which), replay the pending ones one at a time inside a transaction that is rolled back,
 * to name the one that throws.
 */
async function findFailingMigration(
  url: string,
  migrationsDir: string,
): Promise<{ tag: string; error: string } | undefined> {
  const applied = await appliedHashes(url);
  const tags = readJournal(migrationsDir).map((e) => e.tag);
  const pending = readMigrationFiles({ migrationsFolder: migrationsDir })
    .map((m, i) => ({ ...m, tag: tags[i] ?? `entry ${i}` }))
    .filter((m) => !applied.has(m.hash));
  const sql = postgres(url, quiet);
  let found: { tag: string; error: string } | undefined;
  const rollback = new Error('rollback');
  try {
    await sql.begin(async (tx) => {
      for (const m of pending) {
        for (const statement of m.sql) {
          if (!statement.trim()) continue;
          try {
            await tx.unsafe(statement);
          } catch (err) {
            found = { tag: m.tag, error: describeError(err) };
            throw rollback;
          }
        }
      }
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
  return found;
}

/** A free TCP port, chosen by the OS (so never 3000, 3100, 3101, 4173 or another session's). */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

const LOG_TAIL_LINES = 30;

/**
 * Start the API entry against `databaseUrl` with the dev-API environment of the Playwright config
 * (apps/web/e2e/playwright.config.ts) and wait for a healthy /api/v1/health. Returns a failure
 * sentence (with the log tail), or undefined when healthy.
 */
export async function startApiAndCheckHealth(
  databaseUrl: string,
  { entry, timeoutMs = 60_000 }: ApiOptions,
): Promise<{ failure: string | undefined; port: number }> {
  const port = await freePort();
  const workDir = mkdtempSync(join(tmpdir(), 'ccq-upgrade-api-'));
  // A clean environment: a developer's .env (SF_MODE=live, real mail) must not reach this process.
  const passthrough = [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of passthrough) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, {
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_BASE_URL: `http://localhost:${port}`,
    GIT_SHA: 'upgrade-check',
    LOG_LEVEL: 'warn',
    RATE_LIMIT_MAX: '100000',
    SF_MODE: 'fake',
    MAIL_MODE: 'fake',
    FILESTORE_MODE: 'local',
    FILESTORE_LOCAL_DIR: join(workDir, 'files'),
    // No background jobs while the check runs.
    SF_SYNC_INTERVAL_MINUTES: '0',
    VALIDITY_EXPIRY_INTERVAL_HOURS: '0',
    NOTIFICATION_DISPATCH_INTERVAL_SECONDS: '0',
    FABRIC_CHECK_INTERVAL_MINUTES: '0',
  });

  const lines: string[] = [];
  let partial = '';
  const collect = (chunk: Buffer) => {
    const text = partial + chunk.toString('utf8');
    const parts = text.split(/\r?\n/);
    partial = parts.pop() ?? '';
    lines.push(...parts);
    if (lines.length > LOG_TAIL_LINES * 4) lines.splice(0, lines.length - LOG_TAIL_LINES);
  };
  const tail = () => {
    const all = partial ? [...lines, partial] : lines;
    const last = all.slice(-LOG_TAIL_LINES);
    return last.length > 0 ? last.map((l) => `    | ${l}`).join('\n') : '    | (no output)';
  };

  const child = spawn(process.execPath, [entry], {
    cwd: workDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | undefined;
  const exit = new Promise<void>((done) => {
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      done();
    });
    child.on('error', (err) => {
      spawnError = err;
      exited ??= { code: null, signal: null };
      done();
    });
  });

  const url = `http://127.0.0.1:${port}/api/v1/health`;
  const deadline = Date.now() + timeoutMs;
  let lastBody = '';
  let failure: string | undefined;
  try {
    for (;;) {
      if (spawnError) {
        failure = `The API could not be started (${spawnError.message}).`;
        break;
      }
      if (exited) {
        failure = `The API exited (code ${exited.code ?? exited.signal}) before /api/v1/health reported healthy; the last lines of its log:\n${tail()}`;
        break;
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        lastBody = await response.text();
        const body = JSON.parse(lastBody) as { status?: string; db?: string };
        if (body.status === 'ok' && body.db === 'up') break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        failure = `The API did not report "status":"ok" and "db":"up" on /api/v1/health within ${Math.round(timeoutMs / 1000)} seconds (last response: ${lastBody || 'none'}); the last lines of its log:\n${tail()}`;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    if (!exited) {
      child.kill();
      await Promise.race([exit, new Promise((r) => setTimeout(r, 10_000))]);
    }
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { failure, port };
}

/** Fail fast when the API build carries other migrations than this branch: `pnpm build` is stale. */
export function apiBuildMatches(entry: string, branchMigrationsDir: string): boolean | undefined {
  const built = join(dirname(entry), 'db', 'migrations', 'meta', '_journal.json');
  if (!existsSync(built)) return undefined;
  const a = readJournal(dirname(dirname(built))).map((e) => `${e.tag}@${e.when}`);
  const b = readJournal(branchMigrationsDir).map((e) => `${e.tag}@${e.when}`);
  return a.join() === b.join();
}

export async function runUpgradeCheck({
  adminUrl,
  base,
  branchMigrationsDir = MIGRATIONS_DIR,
  branchAnalyticsSqlDir = ANALYTICS_SQL_DIR,
  api,
  databaseName = `ccq_upgrade_${randomBytes(6).toString('hex')}`,
}: UpgradeCheckOptions): Promise<UpgradeCheckResult> {
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new UsageError(`Refusing unsafe database name: ${databaseName}`);
  }
  const failures: string[] = [];
  const proved: string[] = [];
  const baseEntries = readJournal(base.migrationsDir);
  const branchEntries = readJournal(branchMigrationsDir);

  // 4 first: it needs no database, and its sentence says what to change.
  const journal = checkJournal(baseEntries, branchEntries, base.floor, base.label);
  failures.push(...journal.failures);
  const addedText =
    journal.added.length === 0
      ? 'none'
      : journal.added.map((e) => `${e.tag} (when ${e.when})`).join(', ');
  if (journal.failures.length === 0) {
    proved.push(
      `journal: new entries ${addedText} follow ${base.label}'s ${baseEntries.length} in number and are above ${base.floor}, the largest \`when\` ever merged there.`,
    );
  }

  const admin = postgres(adminUrl, quiet);
  const target = withDatabase(adminUrl, databaseName);
  let created = false;
  try {
    const exists = await admin`select 1 from pg_database where datname = ${databaseName}`;
    if (exists.length > 0) {
      throw new UsageError(
        `A database named ${databaseName} already exists on that server; the check makes its own and will not touch it.`,
      );
    }
    await admin.unsafe(`create database "${databaseName}"`);
    created = true;

    // 2. The base, as the test site has it: its migrations with drizzle's migrator, then its views.
    let baseOk = false;
    {
      const sql = postgres(target, quiet);
      try {
        await ensureRoleMembership(sql);
        await migrate(drizzle(sql), { migrationsFolder: base.migrationsDir });
        if (base.analyticsSqlDir && existsSync(base.analyticsSqlDir)) {
          const dir = base.analyticsSqlDir;
          await sql.begin(async (tx) => {
            for (const file of analyticsSqlFiles(dir)) await tx.unsafe(file.sql);
          });
        }
        baseOk = true;
      } catch (err) {
        failures.push(
          `${base.label}'s own migrations did not apply to an empty database (${describeError(err)}), so ${base.label} itself is broken.`,
        );
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    // 3. This branch's full runMigrations on top.
    let branchOk = false;
    if (baseOk) {
      try {
        await runMigrations(target, {
          migrationsDir: branchMigrationsDir,
          analyticsSqlDir: branchAnalyticsSqlDir,
        });
        branchOk = true;
      } catch (err) {
        if (err instanceof MigrationsNotAppliedError) {
          failures.push(
            `On a database at ${base.label}, drizzle skipped ${err.tags.map((t) => `\`${t}\``).join(', ')}: its journal \`when\` is not later than the newest migration already applied there, so the test site would never run it.`,
          );
        } else {
          const culprit = await findFailingMigration(target, branchMigrationsDir).catch(
            () => undefined,
          );
          failures.push(
            culprit
              ? `\`${culprit.tag}\` failed when applied on top of ${base.label}: ${culprit.error}.`
              : `runMigrations failed on top of ${base.label} after the migrations applied (schema comments or analytics views): ${describeError(err)}.`,
          );
        }
      }
    }
    if (branchOk) {
      const applied = await appliedHashes(target);
      const files = readMigrationFiles({ migrationsFolder: branchMigrationsDir });
      const missing = files.flatMap((m, i) =>
        applied.has(m.hash) ? [] : [branchEntries[i]?.tag ?? `entry ${i}`],
      );
      if (missing.length > 0) {
        failures.push(
          `After runMigrations, ${missing.map((t) => `\`${t}\``).join(', ')} is not recorded as applied on a database at ${base.label}.`,
        );
        branchOk = false;
      } else {
        proved.push(
          `migrations: ${base.label}'s ${baseEntries.length} applied with drizzle's migrator, then this branch's runMigrations recorded all ${branchEntries.length} journal entries (new: ${addedText}).`,
        );
      }
    }

    // 5. The API, started as the App Service starts it.
    if (api === null) {
      proved.push('api: not started (--no-api).');
    } else if (branchOk) {
      const matches = apiBuildMatches(api.entry, branchMigrationsDir);
      if (matches === false) {
        failures.push(
          `The API build (${api.label ?? api.entry}) carries other migrations than this branch: run \`pnpm build\` first.`,
        );
      } else {
        const { failure } = await startApiAndCheckHealth(target, api);
        if (failure) failures.push(failure);
        else
          proved.push(
            `api: ${api.label ?? api.entry} started on that database (its own migrate and config seed ran) and /api/v1/health reported "status":"ok" and "db":"up".`,
          );
      }
    }
  } finally {
    if (created) {
      await admin
        .unsafe(`drop database if exists "${databaseName}" with (force)`)
        .catch((err: unknown) => {
          failures.push(
            `The check could not drop its database ${databaseName} (${describeError(err)}); drop it by hand.`,
          );
        });
    }
    await admin.end({ timeout: 5 });
  }

  return {
    ok: failures.length === 0,
    failures,
    notes: journal.notes,
    proved,
    databaseName,
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export interface CliArgs {
  base: string;
  api: boolean;
  timeoutSeconds: number;
}

const USAGE = `usage: pnpm release:upgrade-check [--base <ref>] [--no-api] [--timeout <seconds>]
  DATABASE_URL  a Postgres URL with rights to create and drop databases (required)
  --base        the ref whose migrations stand in for the test site's database (default origin/main)
  --no-api      skip starting apps/api/dist/azureStart.js (a partial check; CI never uses it)
  --timeout     seconds to wait for a healthy /api/v1/health (default 60)`;

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { base: 'origin/main', api: true, timeoutSeconds: 60 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--'))
        throw new UsageError(`${arg} needs a value.\n${USAGE}`);
      return v;
    };
    if (arg === '--')
      continue; // pnpm passes it through
    else if (arg === '--base') args.base = value();
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (arg === '--no-api') args.api = false;
    else if (arg === '--timeout') args.timeoutSeconds = Number(value());
    else if (arg === '--help' || arg === '-h') throw new UsageError(USAGE);
    else throw new UsageError(`Unknown argument ${arg}.\n${USAGE}`);
  }
  if (!args.base) throw new UsageError(`--base needs a value.\n${USAGE}`);
  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
    throw new UsageError(`--timeout must be a positive number of seconds.\n${USAGE}`);
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new UsageError(`DATABASE_URL is not set.\n${USAGE}`);

  const repoRoot = repoRootOf(fileURLToPath(new URL('.', import.meta.url)));
  if (isShallow(repoRoot)) {
    throw new UsageError(
      'This clone is shallow, so the largest `when` ever merged cannot be read: run `git fetch --unshallow` (in CI, checkout with fetch-depth: 0).',
    );
  }
  const sha = resolveRef(repoRoot, args.base);
  const entry = resolve(repoRoot, API_ENTRY_PATH);
  if (args.api && !existsSync(entry)) {
    throw new UsageError(
      `${API_ENTRY_PATH} not found: run \`pnpm build\` first (or pass --no-api).`,
    );
  }

  const scratch = mkdtempSync(join(tmpdir(), 'ccq-upgrade-base-'));
  try {
    exportTree(repoRoot, sha, [MIGRATIONS_PATH, ANALYTICS_PATH], scratch);
    const result = await runUpgradeCheck({
      adminUrl,
      base: {
        label: `${args.base} (${sha.slice(0, 7)})`,
        migrationsDir: join(scratch, MIGRATIONS_PATH),
        analyticsSqlDir: join(scratch, ANALYTICS_PATH),
        floor: largestWhenEverMerged(repoRoot, sha),
      },
      api: args.api
        ? { entry, label: API_ENTRY_PATH, timeoutMs: args.timeoutSeconds * 1000 }
        : null,
    });
    for (const note of result.notes) console.warn(`note: ${note}`);
    if (!result.ok) {
      console.error(`release:upgrade-check FAILED against ${args.base} (${sha.slice(0, 7)}):`);
      for (const failure of result.failures) console.error(`- ${failure}`);
      return 1;
    }
    for (const line of result.proved) console.warn(`ok ${line}`);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main();
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      process.exitCode = 2;
    } else {
      console.error(`release:upgrade-check could not run: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
}
