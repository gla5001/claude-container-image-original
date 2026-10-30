import tseslint from 'typescript-eslint';

// Prettier owns formatting; ESLint only adds the structural rules Prettier can't express.
export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,ts,tsx}'],
    extends: [tseslint.configs.base],
    rules: {
      curly: ['error', 'all'],
      'padding-line-between-statements': ['error', { blankLine: 'always', prev: 'block-like', next: '*' }],
    },
  },
);
