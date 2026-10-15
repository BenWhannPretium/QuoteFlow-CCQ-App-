import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CCQ never writes to Salesforce (CLAUDE.md rule 5; the integration user is read-only by permission
 * set, Rachel Dew). This is the second check after the ESLint rule in packages/integrations/eslint.config.js:
 * no jsforce write call may appear anywhere in the connector's source.
 */
const SF_WRITE_CALL =
  /\.\s*(create|insert|update|upsert|destroy|del|delete|bulk2?|apex|request(Post|Put|Patch|Delete)|(insert|update|upsert|destroy|delete|deleteHard)Bulk)\s*\(/;
const SF_WRITE_PROPERTY = /\.\s*(bulk2?|apex)\b/;

const dir = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('Salesforce connector is read-only', () => {
  const files = sourceFiles(dir);

  it('scans the connector source', () => {
    expect(files.map((f) => f.slice(dir.length))).toEqual(
      expect.arrayContaining(['jsforce.ts', 'fake.ts', 'reader.ts', 'fieldMap.ts']),
    );
  });

  it.each(files.map((f) => [f.slice(dir.length), f]))('%s has no write calls', (_name, file) => {
    const offending = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line: line.replace(/\/\/.*$|^\s*\*.*$/, ''), no: i + 1 }))
      .filter(({ line }) => SF_WRITE_CALL.test(line) || SF_WRITE_PROPERTY.test(line))
      .map(({ line, no }) => `${no}: ${line.trim()}`);
    expect(offending).toEqual([]);
  });

  it('the pattern catches the jsforce write API', () => {
    for (const call of [
      "conn.sobject('Opportunity').create({})",
      'conn.sobject(x).update(rec)',
      'conn.sobject(x).upsert(rec, "Id")',
      'conn.sobject(x).destroy(id)',
      'conn.sobject(x).del(id)',
      'conn.bulk.load("Opportunity", "insert", rows)',
      'conn.apex.post("/x", body)',
      "conn.requestPost('/sobjects/Opportunity', {})",
    ]) {
      expect(SF_WRITE_CALL.test(call) || SF_WRITE_PROPERTY.test(call), call).toBe(true);
    }
    expect(SF_WRITE_CALL.test('conn.query(soql)')).toBe(false);
  });
});
