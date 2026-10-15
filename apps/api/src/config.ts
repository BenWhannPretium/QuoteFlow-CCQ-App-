import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    AUTH_MODE: z.enum(['entra', 'dev']),
    ENTRA_TENANT_ID: nonEmpty.optional(),
    ENTRA_API_AUDIENCE: nonEmpty.optional(),

    APP_BASE_URL: z.url(),
    GIT_SHA: nonEmpty.default('dev'),

    /** Requests per minute per client before 429. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /** Built SPA to serve in production. Defaults to apps/web/dist relative to this bundle. */
    WEB_DIST_DIR: nonEmpty.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message:
          'AUTH_MODE=dev is forbidden when NODE_ENV=production. Dev auth uses fake users and must never run in production.',
      });
    }
    if (env.AUTH_MODE === 'entra') {
      for (const key of ['ENTRA_TENANT_ID', 'ENTRA_API_AUDIENCE'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AUTH_MODE=entra`,
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parse and validate config from the environment. Throws ConfigError with readable issues. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat `KEY=` (blank, as in .env.example) the same as unset so defaults and "required when" rules apply.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
