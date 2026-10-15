import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', '.cache/**', 'tests/**', 'addon/**', '*.mjs'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
    },
  },
);
