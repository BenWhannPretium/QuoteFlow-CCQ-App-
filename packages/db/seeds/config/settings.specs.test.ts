import { parseSettingValue, SETTING_SPECS } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { APP_SETTINGS } from './settings';

/**
 * Audit 2026-11-17 (B-02). A setting with no spec takes any JSON from the Admin console
 * (`settingSpec` falls back to `z.json()`). `intake_other_description_max_length` had none: saving 0, -1
 * or 2.5 was accepted and audited, and the intake config (a positive whole number) then failed to parse
 * on every draft, submit and engineering-queue request, a 500 for everyone until the row was fixed by
 * hand. This guard keeps every seeded setting behind a validator.
 */
describe('every seeded app setting has a validating spec', () => {
  const specs = new Set(SETTING_SPECS.map((s) => s.key));

  it('none falls back to the accept-anything JSON editor', () => {
    expect(APP_SETTINGS.map((s) => s.key).filter((key) => !specs.has(key))).toEqual([]);
  });

  it('every seeded value passes its own spec', () => {
    const rejected = APP_SETTINGS.flatMap((s) => {
      try {
        parseSettingValue(s.key, s.value);
        return [];
      } catch (err) {
        return [`${s.key}: ${String(err)}`];
      }
    });
    expect(rejected).toEqual([]);
  });

  it('refuses a length that the intake config could not read back', () => {
    for (const bad of [0, -1, 2.5, '200', null]) {
      expect(
        () => parseSettingValue('intake_other_description_max_length', bad),
        String(bad),
      ).toThrow();
    }
    expect(parseSettingValue('intake_other_description_max_length', 200)).toBe(200);
  });

  it('refuses a malformed capacity basis and accepts the seeded one', () => {
    expect(() => parseSettingValue('capacity_basis', { scheduledRunDaysPerYear: 0 })).toThrow();
    expect(() => parseSettingValue('capacity_basis', 'x')).toThrow();
    const seeded = APP_SETTINGS.find((s) => s.key === 'capacity_basis')!.value;
    expect(parseSettingValue('capacity_basis', seeded)).toEqual(seeded);
  });
});
