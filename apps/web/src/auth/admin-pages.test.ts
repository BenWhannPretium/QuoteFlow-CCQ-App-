import { describe, expect, it } from 'vitest';

import { adminPagePermission } from './admin-pages';

describe('adminPagePermission', () => {
  it.each([
    ['/admin', 'config.read'],
    ['/admin/integrations', 'config.read'],
    ['/admin/settings', 'config.read'],
    ['/admin/decision-log', 'config.read'],
    ['/admin/reports/erf-linkage', 'config.manage'],
    ['/admin/ui-kit', 'config.manage'],
    ['/admin/audit', 'audit.read'],
    ['/admin/reports/usage', 'audit.read'],
    ['/admin/override-log', 'overrideLog.read'],
    ['/admin/feedback', 'feedback.triage'],
    ['/admin/reports/outcomes', 'analytics.read'],
  ])('%s needs %s', (path, permission) => {
    expect(adminPagePermission(path)).toBe(permission);
  });
});
