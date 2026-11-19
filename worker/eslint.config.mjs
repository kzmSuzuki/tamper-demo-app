import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: {
      eqeqeq: 'error',
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-unreachable': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['test/**/*.mjs', 'frontend/js/**/*.js'],
    rules: {
      eqeqeq: 'error',
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
