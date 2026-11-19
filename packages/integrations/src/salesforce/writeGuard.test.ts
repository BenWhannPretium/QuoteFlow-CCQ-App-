import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SF_WRITE_ALLOW_LIST } from './writeMap';

/**
 * FB-29: write calls appear ONLY in the writer files. The ESLint rule (eslint.config.js, `SF_WRITER_FILES`)
 * and readonly.test.ts exempt exactly these; this test fails if a write call shows up anywhere else in the
 * connector (the reader, its factory create.ts, the fake, the field map, the auth modules), and if the writer
 * file stops being the one place that has one.
 */
const WRITER_FILES = ['jsforceWriter.ts'];

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

const hasWriteCall = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$|^\s*\*.*$/, ''))
    .some((line) => SF_WRITE_CALL.test(line) || SF_WRITE_PROPERTY.test(line));

describe('Salesforce write calls live only in the writer files', () => {
  const files = sourceFiles(dir).map((f) => ({ name: f.slice(dir.length).split(sep).join('/'), f }));

  it('finds a write call in exactly the writer files', () => {
    const withWrites = files.filter(({ f }) => hasWriteCall(f)).map(({ name }) => name);
    expect(withWrites.sort()).toEqual([...WRITER_FILES].sort());
  });

  it('keeps the reader side, its factory and the fakes in the scan', () => {
    expect(files.map((x) => x.name)).toEqual(
      expect.arrayContaining(['create.ts', 'reader.ts', 'jsforce.ts', 'fake.ts', 'fakeWriter.ts', 'createWriter.ts']),
    );
  });

  it('the allow-list names Opportunity fields only, and no figure', () => {
    expect(Object.keys(SF_WRITE_ALLOW_LIST)).toEqual(['Opportunity']);
    const sensitive = /price|cost|margin|revenue|discount|capital|subtotal|amount/i;
    for (const field of SF_WRITE_ALLOW_LIST.Opportunity) {
      expect(sensitive.test(field), field).toBe(false);
    }
  });
});
