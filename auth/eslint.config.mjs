import tseslint from 'typescript-eslint'

// Async persistence safety net: a missing `await` on a database call must fail the lint.
const INTERNALS = '**/authentication/**'
const KEEP_FACADE = '!**/authentication/index.js'

export default tseslint.config({
  files: ['src/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-floating-promises': ['error', {
      allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'before', 'after', 'beforeEach', 'afterEach', 'suite'] }],
    }],
    // Test callbacks legitimately return promises to the runner.
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    '@typescript-eslint/strict-boolean-expressions': 'off',
  },
}, {
  // Authentication is reached only through its façade, `authentication/index.ts`.
  files: ['src/**/*.ts'],
  ignores: ['src/authentication/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: [INTERNALS, KEEP_FACADE], message: 'Import authentication through its façade: authentication/index.js.' }],
    }],
    'no-restricted-syntax': ['error', {
      selector: "ImportExpression[source.value=/authentication\\/.+/]:not([source.value=/authentication\\/index\\.js$/])",
      message: 'Import authentication through its façade: authentication/index.js.',
    }],
  },
})
