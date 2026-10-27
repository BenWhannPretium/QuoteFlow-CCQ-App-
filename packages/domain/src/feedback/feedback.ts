/**
 * B-23 in-app feedback ("Report an issue") and UAT defect triage. Pure rules shared by the API, the
 * admin page and `pnpm uat:defects`. Severity rules: docs/uat/README.md.
 */

export const FEEDBACK_TYPES = ['bug', 'confusing', 'missing', 'idea'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'fixing', 'fixed', 'wont_fix'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 1 blocks a core flow · 2 wrong data or permission · 3 usability · 4 cosmetic. */
export const FEEDBACK_SEVERITIES = [1, 2, 3, 4] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export const FEEDBACK_SEVERITY_LABELS: Readonly<Record<FeedbackSeverity, string>> = {
  1: 'Sev-1: blocks a core flow',
  2: 'Sev-2: wrong data or permission',
  3: 'Sev-3: usability',
  4: 'Sev-4: cosmetic',
};

export const FEEDBACK_TYPE_LABELS: Readonly<Record<FeedbackType, string>> = {
  bug: 'Something is broken',
  confusing: 'Something is confusing',
  missing: 'Something is missing',
  idea: 'An idea',
};

export const FEEDBACK_STATUS_LABELS: Readonly<Record<FeedbackStatus, string>> = {
  new: 'New',
  triaged: 'Triaged',
  fixing: 'Fixing',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
};

/** Largest screenshot stored with a report (bytes, after decoding). */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const FEEDBACK_SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const FEEDBACK_DESCRIPTION_MAX = 4000;

/** Sev-1/2 must be fixed before UAT sign-off; Sev-3/4 go to the P1 backlog unless trivial. */
export function mustFixBeforeSignoff(severity: number): boolean {
  return severity <= 2;
}

/** Still needs work: not fixed and not closed as won't fix. */
export function isOpenFeedback(status: string): boolean {
  return status !== 'fixed' && status !== 'wont_fix';
}

/** The CCQ quote number in an app path (`/quotes/CCQ-2026-00012/…`), if any. */
export function quoteNumberFromPath(path: string): string | null {
  return /\b(CCQ-\d{4}-\d{5})\b/.exec(path)?.[1] ?? null;
}

export interface FeedbackForIssue {
  id: string;
  type: string;
  severity: number;
  description: string;
  route: string;
  quoteNumber: string | null;
  reporterRoles: string;
  appVersion: string | null;
  userAgent: string | null;
  createdAt: string;
  hasScreenshot: boolean;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const cell = (s: string) => oneLine(s).replace(/\|/g, '\\|');

/** Title for a GitHub issue: `[Sev-2][bug] first words of the description`. */
export function feedbackIssueTitle(f: Pick<FeedbackForIssue, 'type' | 'severity' | 'description'>) {
  const words = oneLine(f.description);
  const short = words.length > 70 ? `${words.slice(0, 69).trimEnd()}…` : words;
  return `[Sev-${f.severity}][${f.type}] ${short}`;
}

/**
 * GitHub-flavoured markdown for an issue (pasted by an Admin; the app holds no GitHub token). The
 * reporter's name is left out on purpose: the issue tracker may be wider than the CCQ cohort.
 */
export function feedbackIssueMarkdown(f: FeedbackForIssue): string {
  const sev =
    (FEEDBACK_SEVERITY_LABELS as Record<number, string>)[f.severity] ?? `Sev-${f.severity}`;
  return [
    `**${sev}** · ${(FEEDBACK_TYPE_LABELS as Record<string, string>)[f.type] ?? f.type}`,
    '',
    '### What happened',
    '',
    f.description.trim(),
    '',
    '### Context',
    '',
    '| | |',
    '|---|---|',
    `| Page | \`${cell(f.route)}\` |`,
    `| Quote | ${f.quoteNumber ?? '—'} |`,
    `| Role(s) | ${cell(f.reporterRoles) || '—'} |`,
    `| App version | ${f.appVersion ? `\`${cell(f.appVersion)}\`` : '—'} |`,
    `| Browser | ${f.userAgent ? cell(f.userAgent) : '—'} |`,
    `| Reported | ${f.createdAt} |`,
    `| Screenshot | ${f.hasScreenshot ? 'in QuoteFlow (Admin → Feedback)' : 'none'} |`,
    '',
    `QuoteFlow feedback id: \`${f.id}\``,
  ].join('\n');
}

export interface DefectLogRow {
  id: string;
  createdAt: string;
  type: string;
  severity: number;
  status: string;
  route: string;
  quoteNumber: string | null;
  reporterRoles: string;
  ownerName: string | null;
  githubIssueUrl: string | null;
  summary: string;
}

/**
 * `docs/uat/defect-log.md` (B-23, `pnpm uat:defects`): open Sev-1/2 first (they block sign-off),
 * then the rest by severity and age. Summaries are cut to one line.
 */
export function renderDefectLog(rows: readonly DefectLogRow[], generatedAt: string): string {
  const sorted = [...rows].sort(
    (a, b) =>
      Number(isOpenFeedback(b.status)) - Number(isOpenFeedback(a.status)) ||
      a.severity - b.severity ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const count = (pred: (r: DefectLogRow) => boolean) => rows.filter(pred).length;
  const blocking = count((r) => mustFixBeforeSignoff(r.severity) && isOpenFeedback(r.status));
  const summary = (s: string) => {
    const t = oneLine(s);
    return cell(t.length > 100 ? `${t.slice(0, 99).trimEnd()}…` : t);
  };
  const lines = [
    '# UAT defect log',
    '',
    `> Generated by \`pnpm uat:defects\` from QuoteFlow's feedback table on ${generatedAt}. **Do not edit by hand**; triage in Admin → Feedback and regenerate.`,
    '',
    `**${rows.length}** reports · **${count((r) => isOpenFeedback(r.status))}** open · **${blocking}** open Sev-1/2 (must be fixed by Thu Nov 12)`,
    '',
    '| Sev | Status | Type | Page | Quote | Reported | Role(s) | Owner | Issue | Summary |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...sorted.map(
      (r) =>
        `| ${r.severity} | ${(FEEDBACK_STATUS_LABELS as Record<string, string>)[r.status] ?? r.status} | ${r.type} | \`${cell(r.route)}\` | ${r.quoteNumber ?? ''} | ${r.createdAt.slice(0, 10)} | ${cell(r.reporterRoles)} | ${r.ownerName ? cell(r.ownerName) : ''} | ${r.githubIssueUrl ? `[link](${r.githubIssueUrl})` : ''} | ${summary(r.summary)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
