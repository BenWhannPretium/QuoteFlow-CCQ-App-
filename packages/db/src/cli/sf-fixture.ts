import { writeFileSync } from 'node:fs';

import { buildSfFixture, renderSfFixture, SF_FIXTURE_PATH } from '../../seeds/synthetic/sfFixture';

const fixture = buildSfFixture();
writeFileSync(SF_FIXTURE_PATH, renderSfFixture(fixture));
console.warn(
  `wrote ${fixture.opportunities.length} opportunities, ${fixture.accounts.length} accounts, ` +
    `${fixture.productSpecs.length} product specs to packages/integrations/src/salesforce/fixtures/synthetic.json`,
);
