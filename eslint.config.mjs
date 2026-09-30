import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['packages/poker-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@stellar/*',
            'next',
            'next/*',
            'pg',
            'react',
            'react/*',
            'redis',
            'ws',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Poker Core must not use randomness.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Poker Core must not read the system clock.',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Poker Core must not read the system clock.',
        },
      ],
    },
  },
);
