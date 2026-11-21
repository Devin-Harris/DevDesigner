// Client ESLint flat config (Angular). Run with `npm run lint -w client` (ng lint).
// C5.3 (Wave 6): every rule is an ERROR, except the few listed under "Still warnings" below, which
// have too many hand-fix violations to flip yet (counts in docs/audits/CHANGELOG.md, Wave 6). Template
// rules follow the same scheme.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import boundaries from 'eslint-plugin-boundaries';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Boundaries (§2 A5/A17 + folder-structure import rules) over the pass-2 tree (§4.3).
// Element types are matched against paths relative to client/ (first match wins, so the most
// specific descriptors come first). The rule is an ERROR with no exceptions: where a lower layer needs a
// feature's behaviour, it declares an abstract class and app.config.ts binds the feature's implementation.
// ---------------------------------------------------------------------------
const boundaryElements = [
   { type: 'shared-ui', pattern: 'src/app/shared/ui', partialMatch: false },
   { type: 'shared-feature', pattern: 'src/app/shared/features/*', capture: ['feature'], partialMatch: false },
   { type: 'shared', pattern: 'src/app/shared', partialMatch: false },
   { type: 'core', pattern: 'src/app/core', partialMatch: false },
   // Presentational components anywhere in the editor (sub-feature `components/` and editor/shared/components).
   {
      type: 'editor-component',
      pattern: 'src/app/features/editor/features/*/**/components/*',
      capture: ['sub'],
      partialMatch: false,
   },
   { type: 'editor-component', pattern: 'src/app/features/editor/shared/components/*', partialMatch: false },
   { type: 'editor-sub', pattern: 'src/app/features/editor/features/*', capture: ['sub'], partialMatch: false },
   { type: 'editor-state', pattern: 'src/app/features/editor/state', partialMatch: false },
   // Editor-level parts shared by the entry and every sub-feature (§4.3).
   { type: 'editor-base', pattern: 'src/app/features/editor/helpers', partialMatch: false },
   { type: 'editor-base', pattern: 'src/app/features/editor/models', partialMatch: false },
   { type: 'editor-base', pattern: 'src/app/features/editor/services', partialMatch: false },
   { type: 'editor-base', pattern: 'src/app/features/editor/shared', partialMatch: false },
   // The editor entry (editor.component.*) and its public barrel (index.ts).
   { type: 'editor', pattern: 'src/app/features/editor', partialMatch: false },
   { type: 'feature', pattern: 'src/app/features/*', capture: ['feature'], partialMatch: false },
   { type: 'environments', pattern: 'src/environments', partialMatch: false },
];

const EDITOR_INTERNALS = ['editor-component', 'editor-sub', 'editor-state', 'editor-base'];
const EDITOR_ALL = ['editor', ...EDITOR_INTERNALS];

const boundaryPolicies = [
   {
      from: { element: { type: 'core' } },
      disallow: { to: { element: { types: ['feature', 'shared-feature', ...EDITOR_ALL] } } },
      message: 'core/ is app-wide infrastructure: it must not import features (A17).',
   },
   {
      from: { element: { type: 'shared-ui' } },
      disallow: { to: { element: { types: ['core', 'shared', 'shared-feature', 'feature', ...EDITOR_ALL] } } },
      message: 'shared/ui is the domain-agnostic design system: it imports nothing app-specific (A4/A17).',
   },
   {
      from: { element: { types: ['shared', 'shared-feature'] } },
      disallow: { to: { element: { types: ['feature', ...EDITOR_ALL] } } },
      message: 'shared/ must not import features (A17).',
   },
   {
      from: { element: { type: 'shared-feature' } },
      disallow: {
         to: { element: { type: 'shared-feature', captured: { feature: '!{{ from.element.captured.feature }}' } } },
      },
      message: 'Shared features never import each other; move the common code down to shared/ (folder-structure.md).',
   },
   {
      from: { element: { type: 'feature' } },
      disallow: { to: { element: { types: EDITOR_INTERNALS } } },
      message: 'Hosts may import the editor only through features/editor/index.ts (A5).',
   },
   {
      from: { element: { type: 'feature' } },
      disallow: { to: { element: { type: 'editor', fileInternalPath: '!index.ts' } } },
      message: 'Hosts may import the editor only through features/editor/index.ts (A5).',
   },
   {
      from: { element: { type: 'feature' } },
      disallow: { to: { element: { type: 'feature', captured: { feature: '!{{ from.element.captured.feature }}' } } } },
      message: 'Sibling features never import each other; move the shared code to shared/ (folder-structure.md).',
   },
   {
      from: { element: { types: EDITOR_ALL } },
      disallow: { to: { element: { type: 'feature' } } },
      message: 'The editor must not import sibling features (folder-structure.md).',
   },
   {
      from: { element: { types: ['editor-base', 'editor-state'] } },
      disallow: { to: { element: { types: ['editor', 'editor-sub', 'editor-component'] } } },
      message:
         'Editor-level helpers/models/services/state must not reach into sub-features or the entry (folder-structure.md).',
   },
   {
      from: { element: { types: ['editor-sub', 'editor-component'] } },
      disallow: { to: { element: { type: 'editor' } } },
      message: 'Editor sub-features must not import the editor entry or its barrel (folder-structure.md).',
   },
   {
      from: { element: { types: ['editor-sub', 'editor-component'] } },
      disallow: { to: { element: { type: 'editor-sub', captured: { sub: '!{{ from.element.captured.sub }}' } } } },
      message:
         'Sibling editor sub-features never import each other; move the code to editor/{helpers,models,services,shared} (folder-structure.md).',
   },
   {
      from: { element: { type: 'editor-component' } },
      disallow: { to: { element: { type: 'editor-state' } } },
      message: 'components/ are presentational: inputs in, outputs out, no store access (folder-structure.md).',
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
      extends: [js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
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
         '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'dd', style: 'kebab-case' }],
         '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'dd', style: 'camelCase' }],
         '@angular-eslint/prefer-on-push-component-change-detection': 'error',
         '@angular-eslint/prefer-signals': 'error',
         '@angular-eslint/prefer-output-readonly': 'error',
         '@angular-eslint/use-lifecycle-interface': 'error',
         // Still warnings: 32 renamed inputs across 8 components (public binding names; needs template updates).
         // Off: the signal convention names inputs `name$` and aliases them to `name` (frontend conventions).
         '@angular-eslint/no-input-rename': 'off',
         'no-restricted-syntax': [
            'error',
            {
               selector: "Property[key.name='standalone'][value.value=true]",
               message: "Don't write `standalone: true`; standalone is the default.",
            },
            {
               selector: "MemberExpression[object.name='ViewEncapsulation'][property.name='None']",
               message: 'Keep component styles encapsulated (no ViewEncapsulation.None).',
            },
         ],
         // console.warn / console.error are the deliberate fallback logs in catch blocks.
         'no-console': ['error', { allow: ['warn', 'error'] }],
         '@typescript-eslint/no-explicit-any': 'error',
         '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
         // Object literals use `satisfies` or a typed const; the few deliberate partial rows say why inline.
         '@typescript-eslint/consistent-type-assertions': [
            'error',
            { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
         ],
         // Files over 600 code lines split into part classes (host passed in) or *.helpers.ts modules.
         'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
         'boundaries/dependencies': ['error', { default: 'allow', policies: boundaryPolicies }],
      },
   },
   {
      // A2: the admin dashboard stays in its lazy chunk. Nothing outside features/admin may import it
      // statically (app.routes.ts reaches it only through `loadChildren: () => import(...)`).
      files: ['src/**/*.ts'],
      ignores: ['src/app/features/admin/**'],
      rules: {
         'no-restricted-imports': [
            'error',
            {
               patterns: [
                  {
                     group: ['**/features/admin', '**/features/admin/**'],
                     message: 'features/admin is lazy-loaded behind adminGuard; import it only via the admin route.',
                  },
               ],
            },
         ],
      },
   },
   {
      files: ['**/*.spec.ts'],
      rules: {
         'max-lines': 'off',
         'boundaries/dependencies': 'off',
         // Test hosts get generated, numbered selectors.
         '@angular-eslint/component-selector': 'off',
         // Fixtures are deliberately partial rows.
         '@typescript-eslint/consistent-type-assertions': 'off',
      },
   },
   {
      files: ['**/*.html'],
      extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
      rules: {
         // Event bindings are always allowed. Signals read in templates end in `$` (`{{ name$() }}`);
         // anything else is a computed lookup or a pipe (shared/ui/pipes, editor/shared/pipes).
         '@angular-eslint/template/no-call-expression': ['error', { allowSuffix: '$' }],
         '@angular-eslint/template/attributes-order': 'error',
         '@angular-eslint/template/button-has-type': 'error',
         '@angular-eslint/template/prefer-control-flow': 'error',
         '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
         '@angular-eslint/template/banana-in-box': 'error',
         '@angular-eslint/template/no-negated-async': 'error',
         // Still warnings (17 each, keyboard/label a11y on clickable divs): need real markup changes.
         '@angular-eslint/template/click-events-have-key-events': 'error',
         '@angular-eslint/template/interactive-supports-focus': 'error',
         '@angular-eslint/template/label-has-associated-control': [
            'error',
            {
               // The design-system form controls render their own native input inside.
               controlComponents: ['dd-input', 'dd-select', 'dd-checkbox', 'dd-segmented', 'dd-tag-input', 'dd-color-swatches'],
            },
         ],
         // A13: component tags are written with explicit closing tags. Do not enable.
         '@angular-eslint/template/prefer-self-closing-tags': 'off',
      },
   }
);
