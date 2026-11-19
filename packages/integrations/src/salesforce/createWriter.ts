import { FakeSalesforceWriter } from './fakeWriter';
import {
  JsforceSalesforceWriter,
  writeApiFactory,
  type JsforceWriterConfig,
} from './jsforceWriter';
import type { SfLogger } from './reader';
import type { SalesforceWriter } from './writer';

/**
 * FB-29: `SF_WRITE_MODE`. off (the default): no writer at all, nothing can be sent. fake: the in-memory
 * writer (tests, local, dry runs on the test site; refused in production). live: the jsforce writer with
 * its own credentials (config.ts refuses it unless the guards pass). Separate from the reader's factory
 * (`create.ts`), which stays under the read-only guard.
 */
export type SalesforceWriterConfig =
  | { mode: 'off' }
  | { mode: 'fake'; failFirstPerOpportunity?: boolean }
  | ({ mode: 'live'; appEnvironment: string } & JsforceWriterConfig);

export function createSalesforceWriter(
  config: SalesforceWriterConfig,
  options: { logger?: SfLogger } = {},
): SalesforceWriter | null {
  if (config.mode === 'off') return null;
  if (config.mode === 'fake') {
    return new FakeSalesforceWriter({
      failFirstPerOpportunity: config.failFirstPerOpportunity ?? false,
    });
  }
  const { appEnvironment, ...login } = config;
  return new JsforceSalesforceWriter(writeApiFactory(login), {
    appEnvironment,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
