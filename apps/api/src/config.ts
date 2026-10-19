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
    /** SPA app registration (public client, redirect flow). Sent to the browser by GET /auth/config. */
    ENTRA_SPA_CLIENT_ID: nonEmpty.optional(),
    /** API app registration client id. v2 access tokens carry it as `aud`, so it is also accepted. */
    ENTRA_API_CLIENT_ID: nonEmpty.optional(),
    /** App ID URI of the API registration, e.g. api://<api-client-id>. */
    ENTRA_API_AUDIENCE: nonEmpty.optional(),
    /** Delegated scope the SPA requests and the API requires in `scp`. */
    ENTRA_API_SCOPE: nonEmpty.default('access_as_user'),

    APP_BASE_URL: z.url(),
    GIT_SHA: nonEmpty.default('dev'),

    /** Requests per minute per client before 429. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /** Built SPA to serve in production. Defaults to apps/web/dist relative to this bundle. */
    WEB_DIST_DIR: nonEmpty.optional(),

    /** Salesforce (B-06, read-only). fake = synthetic fixture (local, CI); live = jsforce + JWT bearer. */
    SF_MODE: z.enum(['fake', 'live']).default('fake'),
    /** https://test.salesforce.com for the UAT org (sandbox), https://login.salesforce.com for prod. */
    SF_LOGIN_URL: z.url({ protocol: /^https$/ }).default('https://test.salesforce.com'),
    /** Connected app consumer key (Rachel Dew). Not a secret. */
    SF_CLIENT_ID: nonEmpty.optional(),
    /** Read-only integration user, e.g. integration@pretiumpkg.com.uat. */
    SF_USERNAME: nonEmpty.optional(),
    /** PEM private key for the JWT bearer flow. In Azure: a Key Vault reference. Never logged. */
    SF_PRIVATE_KEY: nonEmpty.optional(),
    SF_API_VERSION: z
      .string()
      .regex(/^\d{2,3}\.0$/)
      .default('62.0'),
    /** Delta sync interval in minutes; 0 disables the in-process schedule (manual trigger still works). */
    SF_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),
    /**
     * Pricing application (B-15, read-only). fake = synthetic fixture; sqlserver = Route A (read-only SQL
     * login to views on a replica); fabric = Route B (the D&A Fabric copy, Entra managed identity).
     * The route is the M5 decision (D-PR).
     */
    PRICING_MODE: z.enum(['fake', 'sqlserver', 'fabric']).default('fake'),
    PRICING_SQL_SERVER: nonEmpty.optional(),
    PRICING_SQL_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    PRICING_SQL_DATABASE: nonEmpty.optional(),
    /** Route A: the read-only login scoped to the views. */
    PRICING_SQL_USER: nonEmpty.optional(),
    /** Route A: in Azure a Key Vault reference. Never logged. */
    PRICING_SQL_PASSWORD: nonEmpty.optional(),
    /** Route B: a user-assigned managed identity's client id (blank = system-assigned). */
    PRICING_SQL_MI_CLIENT_ID: nonEmpty.optional(),
    /**
     * B-13: hours between proposal-validity expiry runs (daily); 0 disables the schedule. The job only
     * flags and notifies; nothing auto-closes (D-12).
     */
    VALIDITY_EXPIRY_INTERVAL_HOURS: z.coerce.number().int().min(0).max(168).default(24),
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
    if (env.SF_MODE === 'live') {
      for (const key of ['SF_CLIENT_ID', 'SF_USERNAME', 'SF_PRIVATE_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when SF_MODE=live`,
          });
        }
      }
    }
    const pricingRequired =
      env.PRICING_MODE === 'sqlserver'
        ? ([
            'PRICING_SQL_SERVER',
            'PRICING_SQL_DATABASE',
            'PRICING_SQL_USER',
            'PRICING_SQL_PASSWORD',
          ] as const)
        : env.PRICING_MODE === 'fabric'
          ? (['PRICING_SQL_SERVER', 'PRICING_SQL_DATABASE'] as const)
          : [];
    for (const key of pricingRequired) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when PRICING_MODE=${env.PRICING_MODE}`,
        });
      }
    }
    if (env.AUTH_MODE === 'entra') {
      for (const key of ['ENTRA_TENANT_ID', 'ENTRA_API_AUDIENCE', 'ENTRA_SPA_CLIENT_ID'] as const) {
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
