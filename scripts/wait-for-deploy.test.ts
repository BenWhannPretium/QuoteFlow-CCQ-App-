import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * FB-28: scripts/wait-for-deploy.sh with a fake `gh` and `curl` first on PATH, one test per exit
 * code. Each fake answers from a file of lines, one line per call (the last repeats), so a test can
 * walk the script through states; `-` is an empty answer and `!fail` a failed call.
 */

const SCRIPT = fileURLToPath(new URL('./wait-for-deploy.sh', import.meta.url));
const SHA = 'ae869d0a527340110cc7ea5dc9940aef77d2bcce';
const NEWER = '1111111111111111111111111111111111111111';
const CI_URL = 'https://github.com/o/r/actions/runs/1';
const DEPLOY_URL = 'https://github.com/o/r/actions/runs/2';
const DONE = '2026-11-19T18:26:52Z';

/**
 * POSIX sh: `sh` on Linux. On Windows, Git for Windows' msys sh from `usr/bin` (not `bin/sh.exe`,
 * a wrapper that puts Git's own folders, and its curl, ahead of the fakes on PATH).
 */
function findSh(): { sh: string; path: string[] } | undefined {
  if (process.platform !== 'win32') return { sh: 'sh', path: [] };
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
  if (!exec) return undefined;
  const usrBin = resolve(exec, '..', '..', '..', 'usr', 'bin');
  const sh = join(usrBin, 'sh.exe');
  return existsSync(sh) ? { sh, path: [usrBin] } : undefined;
}
const shell = findSh();

const FAKE = String.raw`#!/bin/sh
# answer from $WFD_FAKE_DIR/<name>, one line per call; the last line repeats
answer() {
  file="$WFD_FAKE_DIR/$1"
  [ -f "$file" ] || { echo "fake: no answers for $1" >&2; exit 1; }
  n=$(cat "$file.n" 2>/dev/null || echo 0)
  n=$((n + 1))
  echo "$n" > "$file.n"
  total=$(wc -l < "$file")
  [ "$n" -gt "$total" ] && n=$total
  line=$(sed -n "$n"p "$file")
  case "$line" in
    '!fail') echo "fake: $1 failed" >&2; exit "$2" ;;
    -) ;;
    *) printf '%s\n' "$line" | sed 's/\\t/\t/g' ;;
  esac
  exit 0
}
`;

const FAKE_GH = `${FAKE}
echo "gh $*" >> "$WFD_FAKE_DIR/calls.log"
case "$1 $2" in
  "api repos/{owner}/{repo}/compare/"*...main) answer compare 1 ;;
  "api repos/{owner}/{repo}/compare/"*) answer compare-version 1 ;;
  "run list")
    case "$*" in
      *ci.yml*) answer ci 1 ;;
      *deploy.yml*) answer deploy 1 ;;
    esac ;;
  "run view") answer "view-$3" 1 ;;
  "variable get") answer variable 1 ;;
esac
echo "fake gh: unexpected $*" >&2
exit 1
`;

const FAKE_CURL = `${FAKE}
echo "curl $*" >> "$WFD_FAKE_DIR/calls.log"
answer health 22
`;

const tsv = (...fields: (string | number)[]) => fields.join('\\t');
const ciRow = (status: string, conclusion = '') => tsv(1, status, conclusion, CI_URL, DONE);
const deployRow = (status: string, conclusion = '') => tsv(2, status, conclusion, DEPLOY_URL, SHA);
const health = (version: string, db = 'up', status = 'ok') =>
  `{"status":"${status}","version":"${version}","db":"${db}","time":"2026-11-19T18:31:00Z"}`;

let dir: string;

function answers(files: Record<string, string[]>) {
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
  }
}

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(shell!.sh, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [dir, ...shell!.path, process.env.PATH ?? ''].join(delimiter),
      WFD_FAKE_DIR: dir,
      WFD_POLL_SECONDS: '0',
      ...env,
    },
  });
  const calls = existsSync(join(dir, 'calls.log'))
    ? readFileSync(join(dir, 'calls.log'), 'utf8')
    : '';
  return {
    code: result.status,
    lines: result.stdout.trim().split('\n').filter(Boolean),
    stderr: result.stderr,
    calls,
  };
}

const happy = {
  compare: [tsv('identical', 0, SHA, SHA)],
  ci: [
    '-',
    ciRow('queued'),
    ciRow('in_progress'),
    ciRow('in_progress'),
    ciRow('completed', 'success'),
  ],
  deploy: ['-', deployRow('in_progress'), deployRow('completed', 'success')],
  variable: ['quoteflow-test'],
  health: ['!fail', health('0000000'), health(SHA)],
};

describe.skipIf(!shell)('scripts/wait-for-deploy.sh', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccq-wfd-'));
    writeFileSync(join(dir, 'gh'), FAKE_GH, { mode: 0o755 });
    writeFileSync(join(dir, 'curl'), FAKE_CURL, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when CI, the deploy and the site all report the sha, one line per state change', () => {
    answers(happy);
    const { code, lines, calls } = run(['ae869d0']);
    expect(lines).toEqual([
      'CI: waiting for the push run on ae869d0a527340110cc7ea5dc9940aef77d2bcce to start',
      `CI: queued ${CI_URL}`,
      `CI: in_progress ${CI_URL}`,
      `CI: success ${CI_URL}`,
      `deploy: waiting for Deploy (test) to start after CI finished at ${DONE}`,
      `deploy: in_progress ${DEPLOY_URL}`,
      `deploy: success ${DEPLOY_URL}`,
      'health: waiting for ae869d0a527340110cc7ea5dc9940aef77d2bcce (site reports no answer)',
      'health: waiting for ae869d0a527340110cc7ea5dc9940aef77d2bcce (site reports 0000000)',
      `healthy: https://quoteflow-test.azurewebsites.net/api/v1/health reports ${SHA} with the database up`,
    ]);
    expect(code).toBe(0);
    // CI is looked up by the full sha on a push to main; the deploy by time, after CI finished.
    expect(calls).toContain(`--commit ${SHA} --event push --branch main`);
    expect(calls).toContain(`("${DONE}" | fromdateiso8601) - 30`);
  });

  it('exits 10 when CI fails, naming the job', () => {
    answers({
      ...happy,
      ci: [ciRow('completed', 'failure')],
      'view-1': ['Lint, typecheck, test, build, e2e'],
    });
    const { code, lines } = run([SHA]);
    expect(lines.at(-1)).toBe(`CI: failure in job "Lint, typecheck, test, build, e2e" ${CI_URL}`);
    expect(code).toBe(10);
  });

  it('exits 10 when no CI run starts', () => {
    answers({ ...happy, ci: ['-'] });
    const { code, lines } = run([SHA], { WFD_CI_START_SECONDS: '0' });
    expect(lines.at(-1)).toBe(`CI: no push run on ${SHA} started within 0 minutes`);
    expect(code).toBe(10);
  });

  it('exits 10 when the sha is not on main', () => {
    answers({ ...happy, compare: [tsv('diverged', 0, SHA, SHA)] });
    const { code, lines } = run([SHA]);
    expect(lines).toEqual([
      `CI: ${SHA} is not on main (compare says diverged); nothing will deploy it`,
    ]);
    expect(code).toBe(10);
  });

  it('exits 11 when the deploy fails, naming the step', () => {
    answers({ ...happy, deploy: [deployRow('completed', 'failure')], 'view-2': ['Deploy'] });
    const { code, lines } = run([SHA]);
    expect(lines.at(-1)).toBe(`deploy: failure at step "Deploy" ${DEPLOY_URL}`);
    expect(code).toBe(11);
  });

  it('exits 11 when the deploy was skipped', () => {
    answers({ ...happy, deploy: [deployRow('completed', 'skipped')] });
    const { code, lines } = run([SHA]);
    expect(lines.at(-1)).toContain(`deploy: skipped ${DEPLOY_URL}`);
    expect(code).toBe(11);
  });

  it('exits 11 when no deploy starts after CI', () => {
    answers({ ...happy, deploy: ['-'] });
    const { code, lines } = run([SHA], { WFD_DEPLOY_START_SECONDS: '0' });
    expect(lines.at(-1)).toBe(
      'deploy: no Deploy (test) run started within 0 minutes of CI finishing',
    );
    expect(code).toBe(11);
  });

  it('exits 12 when the site never reports the sha healthy', () => {
    answers({ ...happy, health: [health(SHA, 'down', 'degraded')] });
    const { code, lines } = run([SHA], { WFD_HEALTH_SECONDS: '0' });
    expect(lines.at(-1)).toMatch(
      /^health: https:\/\/quoteflow-test\.azurewebsites\.net\/api\/v1\/health did not report .* healthy in 0 minutes; last answer: \{"status":"degraded"/,
    );
    expect(code).toBe(12);
  });

  it('exits 13, not a failure, when a newer push cancelled CI on the sha', () => {
    answers({
      ...happy,
      compare: [tsv('identical', 0, SHA, SHA), tsv('ahead', 1, SHA, NEWER)],
      ci: [ciRow('completed', 'cancelled')],
    });
    const { code, lines } = run([SHA]);
    expect(lines.at(-1)).toBe(
      `superseded: CI on ${SHA} (${CI_URL}) was cancelled; main has moved on to ${NEWER}, which includes ${SHA}: run scripts/wait-for-deploy.sh ${NEWER}`,
    );
    expect(code).toBe(13);
  });

  it('exits 13 when a newer deploy superseded this one', () => {
    answers({
      ...happy,
      compare: [tsv('identical', 0, SHA, SHA), tsv('ahead', 1, SHA, NEWER)],
      deploy: [deployRow('completed', 'cancelled')],
    });
    const { code, lines } = run([SHA]);
    expect(lines.at(-1)).toMatch(
      /^superseded: Deploy \(test\) for .* was cancelled; main has moved on/,
    );
    expect(code).toBe(13);
  });

  it('exits 2 on bad usage, and on gh failing three times running', () => {
    expect(run([]).code).toBe(2);
    expect(run(['not-a-sha']).code).toBe(2);
    expect(run([SHA, 'ten']).code).toBe(2);

    answers({ ...happy, ci: ['!fail'] });
    const { code, stderr } = run([SHA]);
    expect(stderr).toContain('gh failed three times running: fake: ci failed');
    expect(code).toBe(2);
  });

  it('prints the gh and curl commands in --dry-run, and runs none of them', () => {
    const { code, lines, calls } = run([SHA, '30', '--dry-run']);
    expect(code).toBe(0);
    expect(calls).toBe('');
    expect(lines.map((l) => l.split(' ')[0])).toEqual(['gh', 'gh', 'gh', 'gh', 'gh', 'gh', 'curl']);
    expect(lines[1]).toContain('up to 30 minutes');
  });
});
