/**
 * Whether an error is a page chunk that could not be loaded. After a deploy, a tab opened before it
 * still asks for the previous build's files, which no longer exist: the browser's dynamic import fails
 * with one of these messages (Chromium and Edge, Firefox, Safari, and Vite's own preload helper).
 * Retrying asks for the same missing file, so the only fix is to reload the page.
 */
const CHUNK_LOAD_FAILURES = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

export function isStaleBuildError(err: unknown): boolean {
  return err instanceof Error && CHUNK_LOAD_FAILURES.some((p) => p.test(err.message));
}
