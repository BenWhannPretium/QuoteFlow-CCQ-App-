import { ccqConfig } from '@ccq/config/eslint';

const FORBIDDEN_MESSAGE = '@ccq/domain must stay pure: no I/O, HTTP, database or UI imports.';

export default [
  ...ccqConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'fs',
            'fs/promises',
            'node:fs',
            'node:fs/promises',
            'http',
            'https',
            'node:http',
            'node:https',
          ].map((name) => ({ name, message: FORBIDDEN_MESSAGE })),
          patterns: [
            {
              group: [
                'pg',
                'pg/*',
                'fastify',
                'fastify/*',
                '@fastify/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'drizzle-orm',
                'drizzle-orm/*',
              ],
              message: FORBIDDEN_MESSAGE,
            },
          ],
        },
      ],
      // The clock is injected: callers pass `now`.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Do not read the clock in the domain package: take `now` as a parameter.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Do not read the clock in the domain package: take `now` as a parameter.',
        },
      ],
    },
  },
];
