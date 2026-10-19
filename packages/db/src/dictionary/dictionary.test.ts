import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildDictionary, commentStatements, renderMarkdown } from './index';

const ARCHITECTURE_TABLES = [
  'app_user',
  'user_role',
  'user_scope',
  'role_permission',
  'value_list',
  'stage_definition',
  'gate_definition',
  'gate_outcome_definition',
  'transition_rule',
  'reason_code',
  'scoring_model',
  'app_setting',
  'sf_stage_map',
  'customer',
  'sf_opportunity_snapshot',
  'quote',
  'stage_history',
  'gate_decision',
  'eng_review',
  'capacity_evidence',
  'pricing_record',
  'override',
  'attachment',
  'comment',
  'handoff_record',
  'activity_event',
  'audit_event',
  'notification',
  'integration_run',
];

describe('schema documentation', () => {
  const tables = buildDictionary(); // throws if any table or column lacks a comment

  it('covers every table in architecture §5', () => {
    const names = tables.map((t) => t.name);
    for (const name of ARCHITECTURE_TABLES) expect(names).toContain(name);
  });

  it('gives every column a meaning and an owner', () => {
    for (const t of tables) {
      for (const col of t.columns) {
        expect(col.meaning.length, `${t.name}.${col.name}`).toBeGreaterThan(3);
        expect(col.owner.length, `${t.name}.${col.name}`).toBeGreaterThan(1);
      }
    }
  });

  it('escapes quotes in COMMENT ON statements', () => {
    const stmts = commentStatements();
    expect(stmts.length).toBe(tables.length + tables.reduce((n, t) => n + t.columns.length, 0));
    expect(stmts.find((s) => s.includes('quote.read.commercialFields'))).toBeDefined();
    for (const s of stmts)
      expect(s).toMatch(
        /^COMMENT ON (TABLE|COLUMN) "[a-z0-9_]+"(\."[a-z0-9_]+")? IS '(?:[^']|'')*'$/,
      );
  });

  it('docs/data-dictionary.md is up to date (run `pnpm db:dictionary`)', () => {
    const file = fileURLToPath(new URL('../../../../docs/data-dictionary.md', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(renderMarkdown(tables));
  });
});
