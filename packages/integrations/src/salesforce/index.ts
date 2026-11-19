export * from './fieldMap';
export * from './mapper';
export * from './reader';
export * from './retry';
export { FakeSalesforceReader, termScore, type SfFixture } from './fake';
export {
  DEFAULT_SF_API_VERSION,
  JsforceSalesforceReader,
  clientCredentialsApiFactory,
  describedFieldFor,
  jsforceApi,
  jwtApiFactory,
  sfApiFactory,
  type JsforceReaderConfig,
  type JsforceReaderOptions,
  type SfApi,
  type SfApiFactory,
  type SfQueryResult,
} from './jsforce';
export { LOGIN_URLS, jwtAssertion, jwtLogin, type JwtLoginConfig } from './jwt';
export {
  SfAuthError,
  clientCredentialsLogin,
  requestToken,
  type ClientCredentialsConfig,
  type SfAuthFlow,
  type SfSession,
} from './oauth';
export { loadSyntheticFixture } from './fixtures/index';
export { createSalesforceReader, type SalesforceReaderConfig } from './create';
// FB-29: the governed write (off by default; see writer.ts).
export {
  SF_ID,
  sfWriteHostProblem,
  type SalesforceWriter,
  type SfStageResult,
  type SfWriteResult,
} from './writer';
export { SF_WRITE_ALLOW_LIST, isWritableSfField } from './writeMap';
export { FakeSalesforceWriter, type FakeWriteCall, type FakeWriteFailure } from './fakeWriter';
export {
  JsforceSalesforceWriter,
  jsforceWriteApi,
  writeApiFactory,
  type JsforceWriterConfig,
  type SfWriteApi,
  type SfWriteApiFactory,
} from './jsforceWriter';
export { createSalesforceWriter, type SalesforceWriterConfig } from './createWriter';
