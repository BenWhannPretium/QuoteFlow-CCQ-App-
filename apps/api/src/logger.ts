import type { FastifyServerOptions } from 'fastify';
import { stdSerializers } from 'pino';

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
 * Postgres error fields that can echo row or statement contents ("Failing row contains (…)", the
 * statement text, its parameters). The code, message, table, column and constraint stay: they say what
 * failed without saying for which customer.
 */
const ERR_DATA_FIELDS = ['detail', 'where', 'query', 'parameters', 'internalQuery'] as const;

/** An error for the log: type, message, stack and code, minus anything that can carry row data. */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return redactSensitive(err);
  // A plain copy: pino's serialized error has its own prototype, which `redactSensitive` would skip.
  const out: Record<string, unknown> = { ...stdSerializers.err(err) };
  for (const field of ERR_DATA_FIELDS) delete out[field];
  return redactSensitive(out);
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
  return { method: req.method, url: pathOnly(req.url), remoteAddress: req.ip };
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
