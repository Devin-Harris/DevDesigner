// Client ESLint flat config (Angular). Run with `npm run lint -w client` (ng lint).
// Pass 0 guardrails (docs/audits/03-code-cleanliness.md §7): every rule is a WARNING except
// `@typescript-eslint/no-explicit-any`. Rules are flipped to error as each later pass clears them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import boundaries from 'eslint-plugin-boundaries';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));

/** Downgrade every `error` in the given configs to `warn` (pass 0 is warn-only). */
function warnOnly(configs) {
   return configs.map((config) => {
      if (!config.rules) return config;
      const rules = Object.fromEntries(
         Object.entries(config.rules).map(([name, value]) => {
            if (value === 'error' || value === 2) return [name, 'warn'];
            if (Array.isArray(value) && (value[0] === 'error' || value[0] === 2))
               return [name, ['warn', ...value.slice(1)]];
            return [name, value];
         })
      );
      return { ...config, rules };
   });
}

// ---------------------------------------------------------------------------
// Boundaries (§2 A5/A17 + folder-structure import rules, as far as the current folders allow).
// Element types are matched against paths relative to client/ (first match wins, so the most
// specific descriptors come first).
// ---------------------------------------------------------------------------
const boundaryElements = [
   { type: 'shared-ui', pattern: 'src/app/shared/ui', partialMatch: false },
   { type: 'shared', pattern: 'src/app/shared', partialMatch: false },
   { type: 'core', pattern: 'src/app/core', partialMatch: false },
   { type: 'stores', pattern: 'src/app/stores', partialMatch: false },
   { type: 'editor', pattern: 'src/app/features/editor', partialMatch: false },
   { type: 'feature', pattern: 'src/app/features/*', capture: ['feature'], partialMatch: false },
   { type: 'environments', pattern: 'src/environments', partialMatch: false },
];

const boundaryPolicies = [
   {
      from: { element: { type: 'core' } },
      disallow: { to: { element: { types: ['feature', 'editor', 'stores'] } } },
      message: 'core/ is app-wide infrastructure: it must not import features or stores (A17).',
   },
   {
      from: { element: { type: 'shared-ui' } },
      disallow: { to: { element: { types: ['core', 'shared', 'feature', 'editor', 'stores'] } } },
      message: 'shared/ui is the domain-agnostic design system: it imports nothing app-specific (A4/A17).',
   },
   {
      from: { element: { type: 'shared' } },
      disallow: { to: { element: { types: ['feature', 'editor', 'stores'] } } },
      message: 'shared/ must not import features or stores (A17).',
   },
   {
      from: { element: { type: 'stores' } },
      disallow: { to: { element: { types: ['feature', 'editor'] } } },
      message: 'Stores must not import feature internals; move the helper into the store or shared/ (A17).',
   },
   {
      from: { element: { type: 'feature' } },
      // features/editor/index.ts is the editor's public surface (A5). It does not exist yet (pass 2.6).
      disallow: { to: { element: { type: 'editor', fileInternalPath: '!index.ts' } } },
      message: 'Hosts may import the editor only through features/editor/index.ts (A5).',
   },
   {
      from: { element: { type: 'feature' } },
      disallow: { to: { element: { type: 'feature', captured: { feature: '!{{ from.element.captured.feature }}' } } } },
      message: 'Sibling features never import each other; move the shared code to shared/ (folder-structure.md).',
   },
   {
      from: { element: { type: 'editor' } },
      disallow: { to: { element: { type: 'feature' } } },
      message: 'The editor must not import sibling features (folder-structure.md).',
   },
];

export default tseslint.config(
   {
      ignores: [
         'dist/**',
         'node_modules/**',
         '.angular/**',
         'coverage/**',
         'scripts/**',
         '*.config.*',
         'setup-jest.ts',
      ],
   },
   {
      files: ['**/*.ts'],
      extends: warnOnly([js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended]),
      processor: angular.processInlineTemplates,
      plugins: { boundaries },
      settings: {
         'boundaries/root-path': clientRoot,
         'boundaries/elements': boundaryElements,
         'import/resolver': {
            typescript: { project: path.join(clientRoot, 'tsconfig.app.json') },
         },
      },
      rules: {
         '@angular-eslint/component-selector': ['warn', { type: 'element', prefix: 'dd', style: 'kebab-case' }],
         '@angular-eslint/directive-selector': ['warn', { type: 'attribute', prefix: 'dd', style: 'camelCase' }],
         '@angular-eslint/prefer-on-push-component-change-detection': 'warn',
         '@angular-eslint/prefer-signals': 'warn',
         '@angular-eslint/prefer-output-readonly': 'warn',
         '@angular-eslint/use-lifecycle-interface': 'warn',
         '@angular-eslint/no-input-rename': 'warn',
         'no-restricted-syntax': [
            'warn',
            {
               selector: "Property[key.name='standalone'][value.value=true]",
               message: "Don't write `standalone: true`; standalone is the default.",
            },
            {
               selector: "MemberExpression[object.name='ViewEncapsulation'][property.name='None']",
               message: 'Keep component styles encapsulated (no ViewEncapsulation.None).',
            },
         ],
         'no-console': 'warn',
         '@typescript-eslint/no-explicit-any': 'error',
         '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
         '@typescript-eslint/consistent-type-assertions': [
            'warn',
            { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
         ],
         'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
         'boundaries/dependencies': ['warn', { default: 'allow', policies: boundaryPolicies }],
      },
   },
   {
      files: ['**/*.spec.ts'],
      rules: {
         'max-lines': 'off',
         'boundaries/dependencies': 'off',
      },
   },
   {
      files: ['**/*.html'],
      extends: warnOnly([...angular.configs.templateRecommended, ...angular.configs.templateAccessibility]),
      rules: {
         // Event bindings are always allowed. Signal reads count too until the `$` suffix is adopted (pass 3),
         // then `allowSuffix: '$'` lets `{{ name$() }}` through and only real method calls remain.
         '@angular-eslint/template/no-call-expression': ['warn', { allowSuffix: '$' }],
         '@angular-eslint/template/attributes-order': 'warn',
         '@angular-eslint/template/button-has-type': 'warn',
         '@angular-eslint/template/prefer-control-flow': 'warn',
         // A13: component tags are written with explicit closing tags. Do not enable.
         '@angular-eslint/template/prefer-self-closing-tags': 'off',
      },
   }
);
