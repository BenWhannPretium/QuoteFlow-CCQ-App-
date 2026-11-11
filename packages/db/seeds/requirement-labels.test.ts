import {
  REQUIREMENT_LABELS,
  buildHybridConfig,
  requirementKeys,
  type RequiredRule,
} from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { INTAKE_REQUIRED_FIELDS } from './config/settings';

/**
 * DR-* (plain-language messages): every requirement a seeded rule can report has plain words in
 * `REQUIREMENT_LABELS`, so no user reads a rule key. A new seeded rule fails here until it gets a label.
 */
describe('requirement labels', () => {
  const config = buildHybridConfig({ g1Enabled: true });
  const rules: (readonly [string, RequiredRule])[] = [
    ...config.gates.flatMap((g) => g.requiredFields.map((r) => [`gate ${g.key}`, r] as const)),
    ...config.outcomes.flatMap((o) =>
      o.requiredFields.map((r) => [`outcome ${o.gateKey}/${o.key}`, r] as const),
    ),
    ...(INTAKE_REQUIRED_FIELDS as RequiredRule[]).map((r) => ['intake', r] as const),
  ];

  it('covers every key of every seeded gate, outcome and intake rule', () => {
    const missing = rules.flatMap(([where, rule]) =>
      requirementKeys(rule)
        .filter((key) => !REQUIREMENT_LABELS[key])
        .map((key) => `${where}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('labels read as words, never as keys', () => {
    for (const [key, label] of Object.entries(REQUIREMENT_LABELS)) {
      expect(label, key).not.toMatch(/[a-z]+_[a-z]+/);
      expect(label.length, key).toBeGreaterThan(3);
    }
  });
});
