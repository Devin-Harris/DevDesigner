// Root ESLint flat config. Workspace packages (client, server, shared) may extend
// or override this with their own eslint.config where framework-specific rules apply.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // client/ has its own Angular config (client/eslint.config.mjs, run via `npm run lint -w client`).
    ignores: ['**/dist/**', '**/node_modules/**', '**/.angular/**', '**/coverage/**', 'client/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // C5.3: every rule is an error. `_`-prefixed names mark deliberately unused values
    // (rest-sibling omission, positional args).
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Plain JS build/config scripts run on Node.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },
);
