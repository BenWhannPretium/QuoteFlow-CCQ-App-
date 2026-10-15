import type { FastifyServerOptions } from 'fastify';

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

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions['logger']> {
  const pretty = config.NODE_ENV === 'development';
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      log: (obj) => redactSensitive(obj) as Record<string, unknown>,
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
