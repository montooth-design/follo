import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/release/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    rules: {
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
      ],
    },
  },
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: [
      'apps/desktop/src/contexts/**/ui/**/*.{ts,tsx}',
      'apps/desktop/src/renderer/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/configuration/**',
                '**/investigation/**',
                '**/providers/**',
                '**/decisions/**',
              ],
              message:
                'UI code must use the typed desktop bridge, not import main-process services.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/contexts/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/**', '**/application/**', '**/infrastructure/**'],
              message: 'Domain helpers must remain independent of UI and infrastructure.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/contexts/**'],
              message: 'Shared presentation must not depend on a bounded context.',
            },
          ],
        },
      ],
    },
  },
);
