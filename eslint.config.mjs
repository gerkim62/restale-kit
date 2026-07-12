// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'

export default tseslint.config(
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/examples/**',
    ],
  },

  // Base JS
  eslint.configs.recommended,

  // TypeScript rules (only applied to TS/TSX files)
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),

  // ESLint directive comment enforcement
  comments.recommended,

  // Our specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ❌ Ban explicit `any`
      '@typescript-eslint/no-explicit-any': 'error',

      // ❌ Ban unsafe `as` casts
      '@typescript-eslint/no-unsafe-type-assertion': 'error',

      // ❌ Ban non-null assertions (!)
      '@typescript-eslint/no-non-null-assertion': 'error',

      // ❌ Require a reason on every eslint-disable comment
      '@eslint-community/eslint-comments/require-description': 'error',

      // ❌ Catch implicit `any` flowing through assignments/returns
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
    },
  },

  // 📝 Relaxed rules for test files
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@eslint-community/eslint-comments/require-description': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'off',
      '@eslint-community/eslint-comments/disable-enable-pair': 'off',
    },
  },
)
