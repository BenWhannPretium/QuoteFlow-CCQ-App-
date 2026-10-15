import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Git SHA of the running build (from the GIT_SHA env var); "dev" locally. */
  version: z.string(),
  db: z.enum(['up', 'down']),
  /** Server time, ISO 8601 UTC. */
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
