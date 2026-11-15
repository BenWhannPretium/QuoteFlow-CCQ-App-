import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { savedStore } from '@/lib/save-status';

import { SaveStatus, SavedNote, saveStatusOf } from './forms';

/**
 * FB-18 (W13-30): the shared line beside every explicit Save button, rendered to static markup. That it
 * appears beside a real button after a real save is the Playwright spec's job.
 */
describe('SaveStatus', () => {
  it('renders nothing while there is nothing to say', () => {
    expect(renderToStaticMarkup(<SaveStatus />)).toBe('');
    expect(renderToStaticMarkup(<SaveStatus saving={false} saved={false} error={null} />)).toBe('');
  });

  it('says "Saving…" as a status, to screen readers only (the button already reads "Saving…")', () => {
    const html = renderToStaticMarkup(<SaveStatus saving />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="saving"');
    expect(html).toContain('Saving…');
    expect(html).toContain('sr-only');
  });

  it('says "Progress saved" as a status, with a check mark that is hidden from screen readers', () => {
    const html = renderToStaticMarkup(<SaveStatus saved />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-testid="save-progress"');
    expect(html).toContain('data-state="saved"');
    expect(html).toContain('Progress saved');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('sr-only');
    expect(html).not.toContain('role="alert"');
  });

  it('says "Not saved: <reason>" as an alert, in the error colour', () => {
    const html = renderToStaticMarkup(<SaveStatus saved error="Pick a resin from the list" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-state="failed"');
    expect(html).toContain('Not saved: Pick a resin from the list');
    expect(html).toContain('text-destructive');
    expect(html).not.toContain('sr-only');
    expect(html).not.toContain('Progress saved');
  });
});

describe('saveStatusOf (a mutation and "saved, and unchanged since")', () => {
  const idle = { isPending: false, isError: false, error: null };

  it('is saving while the mutation is pending', () => {
    expect(saveStatusOf({ ...idle, isPending: true }, false)).toMatchObject({ saving: true });
  });

  it('is saved only while the caller says so (the form has not changed since)', () => {
    expect(saveStatusOf(idle, true)).toEqual({ saving: false, saved: true, error: null });
    expect(saveStatusOf(idle, false)).toEqual({ saving: false, saved: false, error: null });
  });

  it('gives a reason when the mutation failed', () => {
    const failed = { isPending: false, isError: true, error: new Error('offline') };
    expect(saveStatusOf(failed, false).error).toBe('Something went wrong. Try again.');
  });
});

describe('SavedNote (a save made in a dialog that closes)', () => {
  afterEach(() => savedStore.reset());

  it('says "Progress saved" for its scope once the dialog marks it', () => {
    // Static markup takes the server snapshot (nothing saved): the note is empty until the browser.
    const scope = 'admin-setting:validity_days_default';
    expect(renderToStaticMarkup(<SavedNote scope={scope} />)).toBe('');
    savedStore.mark(scope);
    expect(savedStore.isSaved(scope)).toBe(true);
    expect(savedStore.isSaved('admin-setting:other')).toBe(false);
  });
});
