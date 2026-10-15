import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDictionary, renderMarkdown } from '../dictionary/index';

const target = fileURLToPath(new URL('../../../../docs/data-dictionary.md', import.meta.url));
const tables = buildDictionary();
writeFileSync(target, renderMarkdown(tables));
console.warn(`wrote ${tables.length} tables to docs/data-dictionary.md`);
