import { ccqConfig } from '@ccq/config/eslint';

/**
 * CCQ never writes to Salesforce (CLAUDE.md rule 5). These are the jsforce write calls (SObject
 * create/insert/update/upsert/destroy/del/delete, bulk and Apex REST, raw POST/PUT/PATCH/DELETE).
 * src/salesforce/readonly.test.ts greps for the same names as a second check.
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

const message = 'Salesforce is read-only for CCQ: no write calls (CLAUDE.md rule 5).';

const noWriteCalls = {
  selector: `MemberExpression[property.name=/^(${SF_WRITE_METHODS.join('|')})$/]`,
  message,
};
const noWriteHttp = {
  selector: `Property[key.name='method'][value.value=/^(POST|PUT|PATCH|DELETE)$/i]`,
  message: `${message} Only the OAuth token request in jwt.ts may POST.`,
};

export default [
  ...ccqConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/salesforce/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', noWriteCalls, noWriteHttp] },
  },
  {
    // The JWT token exchange is the one POST, to the OAuth endpoint rather than the data API.
    files: ['src/salesforce/jwt.ts'],
    rules: { 'no-restricted-syntax': ['error', noWriteCalls] },
  },
];
