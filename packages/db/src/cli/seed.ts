import { redactUrl, requireDatabaseUrl } from './env';

const url = requireDatabaseUrl();
// TODO(B-03): seed config tables (hybrid workflow, reason codes, value lists, scoring v1, all
// `provisional: true`) and the synthetic data generator. Synthetic data only, never real customers.
console.warn(`seed: nothing to seed yet (B-03) for ${redactUrl(url)}`);
