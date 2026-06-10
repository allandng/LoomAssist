import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // React Compiler diagnostics (new in react-hooks v6) flag pre-existing
      // patterns that work correctly without the compiler. Keep them visible
      // but non-blocking until those components are migrated.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // Files that intentionally export hooks/constants alongside components
    // (context provider + useX hook pattern documented in CLAUDE.md). The
    // rule only affects dev-time fast refresh, not production builds.
    files: [
      'src/contexts/**/*.tsx',
      'src/store/**/*.tsx',
      'src/components/shared/Icon.tsx',
      'src/components/calendar/ExamClusterBanner.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
