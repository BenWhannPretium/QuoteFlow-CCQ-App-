import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for every QuoteFlow package.
 * @param {{ tsconfigRootDir: string }} options
 */
export function ccqConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/coverage/**',
        '**/node_modules/**',
        '**/.turbo/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/routeTree.gen.ts',
        'docs/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.node },
        parserOptions: {
          projectService: {
            allowDefaultProject: ['*.js', '*.mjs', 'packages/config/*.js'],
          },
          tsconfigRootDir,
        },
      },
      settings: {
        'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        // Fastify plugins are async by contract even when they don't await.
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
            pathGroups: [{ pattern: '@ccq/**', group: 'internal' }],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'import-x/no-duplicates': 'error',
        'import-x/no-named-as-default-member': 'off',
        // TypeScript already checks these, and they misfire on empty placeholder modules.
        'import-x/namespace': 'off',
        'import-x/named': 'off',
        'no-console': ['warn', { allow: ['warn', 'error'] }],
      },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      plugins: { 'react-hooks': reactHooks },
      languageOptions: { globals: { ...globals.browser } },
      rules: { ...reactHooks.configs.recommended.rules },
    },
    prettier,
  );
}
