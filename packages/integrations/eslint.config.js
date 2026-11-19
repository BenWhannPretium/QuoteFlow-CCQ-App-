import { ccqConfig } from '@ccq/config/eslint';

/**
 * The Salesforce connector reads; it writes only through the FB-29 writer (CLAUDE.md rule 5). These are
 * the jsforce write calls (SObject create/insert/update/upsert/destroy/del/delete, bulk and Apex REST, raw
 * POST/PUT/PATCH/DELETE). They are banned in every file of src/salesforce except the writer files below.
 * src/salesforce/readonly.test.ts greps for the same names as a second check, and writeGuard.test.ts fails
 * if a write call appears anywhere but the writer files.
 */
export const SF_WRITE_METHODS = [
  'create',
  'insert',
  'update',
  'upsert',
  'destroy',
  'del',
  'delete',
  'bulk',
  'bulk2',
  'apex',
  'requestPost',
  'requestPut',
  'requestPatch',
  'requestDelete',
  'insertBulk',
  'updateBulk',
  'upsertBulk',
  'destroyBulk',
  'deleteBulk',
  'deleteHardBulk',
];

const message =
  'Salesforce is read-only here: writes go only through the FB-29 writer (jsforceWriter.ts; CLAUDE.md rule 5).';

/** FB-29: the only files allowed a jsforce write call (keep in step with writeGuard.test.ts). */
export const SF_WRITER_FILES = ['src/salesforce/jsforceWriter.ts'];

const noWriteCalls = {
  selector: `MemberExpression[property.name=/^(${SF_WRITE_METHODS.join('|')})$/]`,
  message,
};
const noWriteHttp = {
  selector: `Property[key.name='method'][value.value=/^(POST|PUT|PATCH|DELETE)$/i]`,
  message: `${message} Only the OAuth token request in oauth.ts may POST.`,
};

export default [
  ...ccqConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/salesforce/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', noWriteCalls, noWriteHttp] },
  },
  {
    // The OAuth token request (JWT bearer and client credentials) is the one POST, to the OAuth
    // endpoint rather than the data API.
    files: ['src/salesforce/oauth.ts'],
    rules: { 'no-restricted-syntax': ['error', noWriteCalls] },
  },
  {
    // FB-29: the writer (the one Opportunity update, behind the write allow-list and the write switch).
    // Every other file, the reader's factory create.ts included, stays under the rule above.
    files: SF_WRITER_FILES,
    rules: { 'no-restricted-syntax': 'off' },
  },
];
