import { FakeSalesforceReader } from './fake';
import { loadSyntheticFixture } from './fixtures/index';
import { JsforceSalesforceReader, sfApiFactory, type JsforceReaderConfig } from './jsforce';
import type { MapOptions } from './mapper';
import type { SalesforceReader, SfLogger } from './reader';

export type SalesforceReaderConfig = { mode: 'fake' } | ({ mode: 'live' } & JsforceReaderConfig);

/** The reader for `SF_MODE`: the synthetic fake (local, CI) or the live jsforce reader. */
export function createSalesforceReader(
  config: SalesforceReaderConfig,
  options: MapOptions & { logger?: SfLogger } = {},
): SalesforceReader {
  if (config.mode === 'fake') return new FakeSalesforceReader(loadSyntheticFixture(), options);
  return new JsforceSalesforceReader(sfApiFactory(config), options);
}
