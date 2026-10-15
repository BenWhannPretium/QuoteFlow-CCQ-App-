import { describe, expect, it } from 'vitest';

import { DOMAIN_PACKAGE } from './index';

describe('@ccq/domain', () => {
  it('is wired into the workspace', () => {
    expect(DOMAIN_PACKAGE).toBe('@ccq/domain');
  });
});
