export * from './fieldMap';
export * from './mapper';
export * from './reader';
export * from './retry';
export { FakeSalesforceReader, termScore, type SfFixture } from './fake';
export {
  DEFAULT_SF_API_VERSION,
  JsforceSalesforceReader,
  describedFieldFor,
  jsforceApi,
  jwtApiFactory,
  type JsforceReaderConfig,
  type JsforceReaderOptions,
  type SfApi,
  type SfApiFactory,
  type SfQueryResult,
} from './jsforce';
export { LOGIN_URLS, SfAuthError, jwtAssertion, jwtLogin, type JwtLoginConfig } from './jwt';
export { loadSyntheticFixture } from './fixtures/index';
export { createSalesforceReader, type SalesforceReaderConfig } from './create';
