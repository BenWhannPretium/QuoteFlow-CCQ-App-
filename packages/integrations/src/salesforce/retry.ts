/** Retry, backoff and timeout for Salesforce calls. */

export const SF_TIMEOUT_MS = 20_000;

export class SfTimeoutError extends Error {
  readonly errorCode = 'TIMEOUT';
  constructor(ms: number) {
    super(`Salesforce call timed out after ${ms} ms`);
    this.name = 'SfTimeoutError';
  }
}

/** Fields jsforce and fetch put on errors. */
interface ErrorLike {
  cause?: unknown;
  errorCode?: unknown;
  name?: unknown;
  code?: unknown;
  statusCode?: unknown;
  status?: unknown;
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

/**
 * A short, data-free code for an error (safe to log and to store in integration_run.error):
 * the SF errorCode (REQUEST_LIMIT_EXCEEDED), a network code (ECONNRESET), HTTP_<status>, or for a
 * database error its SQLSTATE as DB_<code>. Messages are never used: they can echo record data.
 */
export function sfErrorCode(err: unknown, depth = 0): string {
  const e = (err ?? {}) as ErrorLike;
  for (const candidate of [e.errorCode, e.code, e.name]) {
    if (typeof candidate !== 'string') continue;
    if (/^[0-9A-Z]{5}$/.test(candidate) && /\d/.test(candidate)) return `DB_${candidate}`;
    if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  const status = httpStatus(err);
  if (status) return `HTTP_${status}`;
  if (e.cause && depth < 3) {
    const inner = sfErrorCode(e.cause, depth + 1);
    if (inner !== 'UNKNOWN') return inner;
  }
  return typeof e.name === 'string' && e.name !== 'Error' ? e.name : 'UNKNOWN';
}

function httpStatus(err: unknown): number | null {
  const e = (err ?? {}) as ErrorLike;
  for (const candidate of [e.statusCode, e.status]) {
    if (typeof candidate === 'number') return candidate;
  }
  // jsforce names HTTP failures ERROR_HTTP_503 etc.
  const match = typeof e.name === 'string' ? /^ERROR_HTTP_(\d{3})$/.exec(e.name) : null;
  return match ? Number(match[1]) : null;
}

/** REQUEST_LIMIT_EXCEEDED, 5xx, timeouts and transient network errors are retried. */
export function isRetryable(err: unknown): boolean {
  const code = sfErrorCode(err);
  if (code === 'REQUEST_LIMIT_EXCEEDED' || code === 'SERVER_UNAVAILABLE' || code === 'TIMEOUT') {
    return true;
  }
  if (NETWORK_CODES.has(code)) return true;
  const status = httpStatus(err);
  return status !== null && status >= 500;
}

/** The session expired or was revoked: log in again once, then retry. */
export const isInvalidSession = (err: unknown) =>
  sfErrorCode(err) === 'INVALID_SESSION_ID' || httpStatus(err) === 401;

export function withTimeout<T>(promise: Promise<T>, ms: number = SF_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SfTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RetryOptions {
  /** Retries after the first attempt. Default 3 (so up to 4 attempts). */
  retries?: number;
  /** First backoff; doubles each retry, with ±20 % jitter. Default 1 s. */
  baseDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; code: string; delayMs: number }) => void;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `fn` with a per-attempt timeout, retrying retryable errors with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 1_000,
    timeoutMs = SF_TIMEOUT_MS,
    sleep = defaultSleep,
    onRetry,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const jitter = 0.8 + Math.random() * 0.4;
      const delayMs = Math.round(baseDelayMs * 2 ** attempt * jitter);
      onRetry?.({ attempt: attempt + 1, code: sfErrorCode(err), delayMs });
      await sleep(delayMs);
    }
  }
}
