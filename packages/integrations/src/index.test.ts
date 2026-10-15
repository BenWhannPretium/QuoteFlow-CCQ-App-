import { describe, expect, it } from 'vitest';

import { INTEGRATIONS_PACKAGE } from './index';

describe('@ccq/integrations', () => {
  it('is wired into the workspace', () => {
    expect(INTEGRATIONS_PACKAGE).toBe('@ccq/integrations');
  });
});
