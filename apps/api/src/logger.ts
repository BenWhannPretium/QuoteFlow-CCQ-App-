import type { FastifyServerOptions } from 'fastify';

import { withoutPort } from './clientIp';
import type { AppConfig } from './config';

/** Exact paths removed from every log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Key patterns redacted at any depth (`*.price*`, `*.token*`): prices, margins and tokens must
 * never reach logs. Pino's path redaction can't express partial-key wildcards, so a log formatter
 * walks the object and masks matching keys.
 */
export const SENSITIVE_KEY = /price|token|margin|secret|password/i;
export const REDACTED = '[Redacted]';

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  // Only plain objects are rebuilt. This formatter runs before pino's serializers, and an Error, a
  // request, a reply or a Date has no enumerable keys of its own: rebuilding one from `Object.entries`
  // turned it into `{}`, so every production log line read `"err":{}`, `"req":{}`, `"res":{}`. They pass
  // through untouched and the serializers below decide what is logged from them.
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

/**
 * Error fields that can echo row or statement contents: Postgres's "Failing row contains (…)" and
 * statement context, and the statement text and bound values the driver and drizzle attach (`query`,
 * `parameters`, `params`, `args`). The code, table, column and constraint stay: they say what failed
 * without saying for which customer.
 *
 * The names are the ones postgres.js sets (snake_case, from the server's error fields): the statement a
 * function, trigger or policy was running is `internal_query`, with `internal_position` pointing into
 * it. `hint` goes too: a `RAISE ... USING HINT` can carry whatever its author put in it. `internalQuery`
 * is node-postgres's spelling, kept in case the driver changes.
 */
const ERR_DATA_FIELDS = new Set([
  'detail',
  'where',
  'hint',
  'query',
  'parameters',
  'params',
  'args',
  'internal_query',
  'internal_position',
  'internalQuery',
  'message',
  'stack',
  'cause',
]);

const QUERY_FAILED = 'Failed query (statement and parameters withheld; see cause)';

/**
 * drizzle wraps every failed statement in an error whose *message* is the SQL text followed by its
 * bound values (`Failed query: insert into … \nparams: Acme Bottling,4.25`). Logged as it is, customer
 * names and figures would sit in `message` and at the head of `stack`.
 */
const isQueryWrapper = (err: Error): boolean => err.message.startsWith('Failed query:');

/** The frames of a stack, without its first line(s), which repeat the message. */
const frames = (stack: string | undefined): string =>
  (stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');

function describeError(err: Error, depth: number): Record<string, unknown> {
  const wrapper = isQueryWrapper(err);
  const sqlstate = (err as { code?: unknown }).code;
  // A Postgres data exception quotes the offending value in its message
  // (`invalid input syntax for type uuid: "…"`); keep the sentence, withhold the value.
  const quotesValue = typeof sqlstate === 'string' && /^22[0-9A-Z]{3}$/.test(sqlstate);
  const type =
    err.constructor?.name && err.constructor.name !== 'Error' ? err.constructor.name : err.name;
  const message = wrapper
    ? QUERY_FAILED
    : quotesValue
      ? err.message.replace(/"[^"]*"/g, '"…"')
      : err.message;
  const out: Record<string, unknown> = {
    type,
    message,
    stack: `${type}: ${message}\n${frames(err.stack)}`,
  };
  for (const [key, value] of Object.entries(err)) {
    if (ERR_DATA_FIELDS.has(key)) continue;
    // Errors carried under another key (AggregateError.errors, a driver's `original`) get the same
    // treatment as the one that carries them.
    if (value instanceof Error) out[key] = depth < 4 ? describeError(value, depth + 1) : value.name;
    else if (Array.isArray(value) && value.some((v) => v instanceof Error)) {
      out[key] = value.map((v: unknown) =>
        v instanceof Error ? (depth < 4 ? describeError(v, depth + 1) : v.name) : v,
      );
    } else out[key] = value;
  }
  // `AggregateError.errors` is not enumerable, so the loop above does not see it.
  if (err instanceof AggregateError && depth < 4) {
    out.errors = (err.errors as unknown[]).map((e) =>
      e instanceof Error ? describeError(e, depth + 1) : e,
    );
  }
  const cause: unknown = err.cause;
  if (cause instanceof Error && depth < 4) {
    const inner = describeError(cause, depth + 1);
    out.cause = inner;
    // The SQLSTATE lives on the driver's error; lift it so `err.code` is one place to look.
    if (out.code === undefined && typeof inner.code === 'string') out.code = inner.code;
  }
  return out;
}

/**
 * An error for the log: type, message, stack frames, code and the cause chain, minus anything that can
 * carry row data. Sensitive keys are masked as everywhere else.
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return redactSensitive(err);
  return redactSensitive(describeError(err, 0));
}

/** The request path without its query string: search text and filters can name a customer. */
const pathOnly = (url: string | undefined): string | undefined => url?.split('?', 1)[0];

interface LoggedRequest {
  method?: string;
  url?: string;
  ip?: string;
}

/** A request for the log: method, path and the client address. Never headers, query or body. */
export function serializeRequest(req: LoggedRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: pathOnly(req.url),
    remoteAddress: req.ip === undefined ? undefined : withoutPort(req.ip),
  };
}

export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions['logger']> {
  const pretty = config.NODE_ENV === 'development';
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      log: (obj) => redactSensitive(obj) as Record<string, unknown>,
    },
    // Fastify types these serializers more narrowly than pino accepts (a fixed error shape); ours return
    // the same fields minus the ones that can carry data.
    serializers: { err: serializeError, req: serializeRequest } as never,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
