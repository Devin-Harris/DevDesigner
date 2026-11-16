// Root ESLint flat config. Workspace packages (client, server, shared) may extend
// or override this with their own eslint.config where framework-specific rules apply.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // client/ has its own Angular config (client/eslint.config.mjs, run via `npm run lint -w client`).
    ignores: ['**/dist/**', '**/node_modules/**', '**/.angular/**', '**/coverage/**', 'client/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
