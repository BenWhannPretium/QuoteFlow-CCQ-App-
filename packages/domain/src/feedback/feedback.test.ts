import { describe, expect, it } from 'vitest';

import {
  feedbackIssueMarkdown,
  feedbackIssueTitle,
  isOpenFeedback,
  mustFixBeforeSignoff,
  quoteNumberFromPath,
  renderDefectLog,
  type DefectLogRow,
} from './feedback';

describe('feedback rules (B-23)', () => {
  it('Sev-1/2 block sign-off; Sev-3/4 do not', () => {
    expect([1, 2, 3, 4].map(mustFixBeforeSignoff)).toEqual([true, true, false, false]);
  });

  it('fixed and won’t fix are closed', () => {
    expect(['new', 'triaged', 'fixing', 'fixed', 'wont_fix'].map(isOpenFeedback)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('finds the quote number in a path', () => {
    expect(quoteNumberFromPath('/quotes/CCQ-2026-00012/engineering')).toBe('CCQ-2026-00012');
    expect(quoteNumberFromPath('/board')).toBeNull();
  });
});

describe('GitHub issue markdown', () => {
  const f = {
    id: '019a0000-0000-7000-8000-000000000f01',
    type: 'bug',
    severity: 2,
    description:
      'The  queue | shows\nthe wrong age for held quotes and it goes on for a long time past seventy chars',
    route: '/queue',
    quoteNumber: 'CCQ-2026-00012',
    reporterRoles: 'EngLead',
    appVersion: 'abc123',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-11-10T15:00:00.000Z',
    hasScreenshot: true,
  };

  it('titles with severity and type, cut to one line', () => {
    const title = feedbackIssueTitle(f);
    expect(title.startsWith('[Sev-2][bug] The queue | shows the wrong age')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('\n');
  });

  it('carries the context but not the reporter’s name', () => {
    const md = feedbackIssueMarkdown(f);
    expect(md).toContain('**Sev-2: wrong data or permission**');
    expect(md).toContain('| Quote | CCQ-2026-00012 |');
    expect(md).toContain('| Page | `/queue` |');
    expect(md).toContain('in QuoteFlow (Admin → Feedback)');
    expect(md).toContain(f.id);
  });
});

describe('defect log', () => {
  const row = (over: Partial<DefectLogRow>): DefectLogRow => ({
    id: 'x',
    createdAt: '2026-11-10T15:00:00.000Z',
    type: 'bug',
    severity: 3,
    status: 'new',
    route: '/',
    quoteNumber: null,
    reporterRoles: 'KAM',
    ownerName: null,
    githubIssueUrl: null,
    summary: 'something',
    ...over,
  });

  it('lists open Sev-1/2 first and counts what blocks sign-off', () => {
    const md = renderDefectLog(
      [
        row({ summary: 'cosmetic', severity: 4 }),
        row({ summary: 'fixed blocker', severity: 1, status: 'fixed' }),
        row({
          summary: 'open blocker | pipe',
          severity: 2,
          githubIssueUrl: 'https://github.com/o/r/issues/1',
        }),
      ],
      '2026-11-10 16:00 UTC',
    );
    const body = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Sev'));
    expect(body.map((l) => l.split(' | ').at(-1))).toEqual([
      'open blocker \\| pipe |',
      'cosmetic |',
      'fixed blocker |',
    ]);
    expect(md).toContain('**3** reports · **2** open · **1** open Sev-1/2');
    expect(md).toContain('[link](https://github.com/o/r/issues/1)');
  });
});
