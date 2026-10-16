import { PRICING_OBJECTS, type PricingObject } from './columnMap';
import { FakePricingReader } from './fake';
import { syntheticPricingFixture } from './fixtures';
import {
  MssqlQueryRunner,
  fabricConfig,
  sqlServerConfig,
  type FabricRouteConfig,
  type SqlServerRouteConfig,
} from './mssql';
import type { PricingLogger, PricingReader } from './reader';
import { SqlPricingReader } from './sql';

/**
 * `PRICING_MODE`: `fake` (synthetic fixture: local, CI, and until M5 grants access), `sqlserver`
 * (Route A) or `fabric` (Route B). Which real route is used is the M5 decision (D-PR).
 */
export type PricingReaderConfig =
  | { mode: 'fake'; synthesize?: boolean }
  | ({ mode: 'sqlserver'; objects?: Record<PricingObject, string> } & SqlServerRouteConfig)
  | ({ mode: 'fabric'; objects?: Record<PricingObject, string> } & FabricRouteConfig);

export function createPricingReader(
  config: PricingReaderConfig,
  options: { logger?: PricingLogger } = {},
): PricingReader {
  switch (config.mode) {
    case 'fake':
      return new FakePricingReader(syntheticPricingFixture(), {
        synthesize: config.synthesize ?? true,
      });
    case 'sqlserver':
      return new SqlPricingReader(new MssqlQueryRunner(sqlServerConfig(config)), {
        mode: 'sqlserver',
        objects: config.objects ?? PRICING_OBJECTS.sqlserver,
        ...options,
      });
    case 'fabric':
      return new SqlPricingReader(new MssqlQueryRunner(fabricConfig(config)), {
        mode: 'fabric',
        objects: config.objects ?? PRICING_OBJECTS.fabric,
        ...options,
      });
  }
}
