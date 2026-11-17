import { ROLES } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { LANDINGS } from './landings';
import {
  WELCOME_INTRO,
  WELCOME_JOBS,
  WELCOME_TITLE,
  readWelcomeDismissed,
  rememberWelcomeDismissed,
  welcomeJobsFor,
} from './welcome';

describe('first-run welcome card', () => {
  it('has an entry for every role, and for no role that does not exist', () => {
    expect(Object.keys(WELCOME_JOBS).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) expect(welcomeJobsFor(role), role).not.toBeNull();
    expect(welcomeJobsFor('NoSuchRole')).toBeNull();
  });

  it('covers every role that lands on the Command Center (Finance and the scheduler included)', () => {
    for (const role of Object.keys(LANDINGS)) expect(welcomeJobsFor(role), role).not.toBeNull();
    expect(welcomeJobsFor('Finance')).not.toBeNull();
    expect(welcomeJobsFor('ProductionScheduler')).not.toBeNull();
  });

  it('gives each role three one-line jobs, each with where it is done', () => {
    for (const role of ROLES) {
      const jobs = WELCOME_JOBS[role];
      expect(jobs, role).toHaveLength(3);
      for (const { job, where } of jobs) {
        expect(job.trim(), role).toBe(job);
        expect(where.trim(), role).toBe(where);
        expect(job.length, `${role}: ${job}`).toBeGreaterThan(10);
        expect(where.length, `${role}: ${where}`).toBeGreaterThan(3);
        // One line on the card: "job: where."
        expect(`${job}: ${where}.`.length, `${role}: ${job}`).toBeLessThanOrEqual(100);
      }
      expect(new Set(jobs.map((j) => j.job)).size, role).toBe(3);
    }
  });

  it('is written in the house style: sentence case, no exclamation marks, no dashes, no gate numbers', () => {
    const texts = [
      WELCOME_TITLE,
      WELCOME_INTRO,
      ...ROLES.flatMap((role) => WELCOME_JOBS[role].flatMap((j) => [j.job, j.where])),
    ];
    for (const text of texts) {
      expect(text, text).not.toMatch(/[!—–]/);
      expect(text, text).not.toMatch(/\bG[1-6]\b/);
    }
    for (const role of ROLES) {
      for (const { job } of WELCOME_JOBS[role]) expect(job, job).toMatch(/^[A-Z][a-z]/);
    }
  });

  it('remembers a dismissal per user, even where storage is not available', () => {
    // Vitest runs this in Node: there is no `window`, as in a browser that blocks storage.
    expect(readWelcomeDismissed('user-a')).toBe(false);
    rememberWelcomeDismissed('user-a');
    expect(readWelcomeDismissed('user-a')).toBe(true);
    expect(readWelcomeDismissed('user-b')).toBe(false);
  });
});
