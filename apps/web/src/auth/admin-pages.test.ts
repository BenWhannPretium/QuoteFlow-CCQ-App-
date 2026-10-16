import { describe, expect, it } from 'vitest';

import { adminPagePermission } from './admin-pages';

describe('adminPagePermission', () => {
  it.each([
    ['/admin', 'config.manage'],
    ['/admin/integrations', 'config.manage'],
    ['/admin/reports/erf-linkage', 'config.manage'],
    ['/admin/audit', 'audit.read'],
    ['/admin/reports/usage', 'audit.read'],
    ['/admin/override-log', 'overrideLog.read'],
    ['/admin/reports/outcomes', 'analytics.read'],
  ])('%s needs %s', (path, permission) => {
    expect(adminPagePermission(path)).toBe(permission);
  });
});
