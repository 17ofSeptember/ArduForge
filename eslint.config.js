/**
 * Lint gate.
 *
 * `tsc` already catches unused locals and every type error, so this config
 * deliberately does not re-state those. It exists for the classes of bug the
 * type checker cannot see: promises nobody awaits, hook dependency arrays that
 * drift from what the hook actually reads, and `any` creeping back in through
 * an untyped dependency.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Tailwind's default palette is removed in client/src/styles/tokens.css
 * (`--color-*: initial`), so `bg-slate-800` no longer generates a rule at all.
 * That fails *silently* — the element just renders unstyled — which is worse
 * than a build error, so this catches it at author time instead.
 *
 * Matches any default-palette colour utility, with or without a variant prefix
 * or opacity modifier: `hover:bg-slate-800`, `text-zinc-400/50`, `border-gray-700`.
 */
const TW_UTILITY = '(bg|text|border|ring|fill|stroke|from|to|via|decoration|outline|accent|caret|divide|placeholder|shadow)';
const TW_PALETTE =
  '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
// `black` and `white` carry no shade suffix, so they need their own alternative.
const BANNED_CLASS = `\\b${TW_UTILITY}-(${TW_PALETTE}-(50|[1-9]00|950)|black|white)\\b`;

/**
 * THEME.md Phase 7 item 1: no raw colour outside tokens.css and the documented
 * exemptions.
 *
 * Matches `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `rgb()` / `hsl()` in
 * either alpha form. Requires a full hex run followed by a word boundary, so
 * the C++ that codegen emits — `#define`, `#include`, `#endif` — does not trip
 * it: `#def` is followed by `i`, which is not a boundary.
 */
const RAW_COLOR = '(#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b|\\b(rgb|hsl)a?\\s*\\()';

const RAW_COLOR_MESSAGE =
  'Raw colour outside tokens.css. Add a token in scripts/generate-tokens.mjs and use it — ' +
  'a literal here is invisible to the contrast gate, which parses tokens.css. ' +
  'If this colour is genuinely functional (a physical wire, saved user data), add the file to ' +
  'the exempt list in eslint.config.js with a reason, and record it in docs/FUNCTIONAL-COLOR.md.';

const NO_RAW_COLOR = [
  { selector: `Literal[value=/${RAW_COLOR}/]`, message: RAW_COLOR_MESSAGE },
  { selector: `TemplateElement[value.raw=/${RAW_COLOR}/]`, message: RAW_COLOR_MESSAGE },
];

const NO_DEFAULT_PALETTE = [
  {
    selector: `Literal[value=/${BANNED_CLASS}/]`,
    message:
      "Tailwind's default palette is removed — this class generates nothing. Use a token utility (bg-card, text-content-muted, border-edge) or add a token to tokens.css.",
  },
  {
    selector: `TemplateElement[value.raw=/${BANNED_CLASS}/]`,
    message:
      "Tailwind's default palette is removed — this class generates nothing. Use a token utility (bg-card, text-content-muted, border-edge) or add a token to tokens.css.",
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      // Generated from firmware/AwryLink by scripts/embed-firmware.mjs.
      'client/src/codegen/awrylinkSource.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped promise in the serial or upload path is exactly the kind of
      // ownership bug §3 of the build plan is about. Non-negotiable.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/no-explicit-any': 'error',

      // Off, and the reason matters. This rule trusts TypeScript's narrowing,
      // and TypeScript cannot see a field mutated by a callback that runs
      // during an `await`. The serial layer is built on exactly that pattern
      // (SerialManager re-checks `entry.cancelled` after awaiting an open,
      // because an abort can land mid-await), so the rule reports the most
      // safety-critical re-checks in the repo as dead code. Acting on it would
      // delete real guards; leaving it on trains us to ignore output.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // Same class of false positive: an `async` method that satisfies an
      // interface returning Promise does not need an await to be correct.
      '@typescript-eslint/require-await': 'off',

      // tsc's noUnusedLocals already covers this and reports it better.
      '@typescript-eslint/no-unused-vars': 'off',

      // An empty catch is allowed only where the code says why it is empty.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',

      // Every hit is a zustand selector — `useGraphStore((s) => s.addNode)`.
      // The rule guards against losing a `this` binding, and these stores are
      // object literals of closures over set/get with zero occurrences of
      // `this` in any of them (verified across graphStore, dashboard/store,
      // projectManager and toast). There is no receiver to lose.
      '@typescript-eslint/unbound-method': 'off',

      // THEME.md Phase 2, tightened in Phase 3 to include `black` and `white`
      // once the last 26 sites moved onto --text-on-semantic,
      // --text-on-interactive, --text-on-destructive and --scrim.
      'no-restricted-syntax': ['error', ...NO_DEFAULT_PALETTE],
    },
  },

  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  /**
   * Build tooling: this config, the vitest configs, and the codegen scripts.
   * None of it ships, and none of it is covered by a workspace tsconfig, so
   * the type-aware rules have no types to work from and report every import
   * as `any`. Lint them syntactically instead of pretending otherwise.
   */
  {
    files: [
      'eslint.config.js',
      '**/*.mjs',
      '**/vitest.config.ts',
      'client/scripts/**/*.ts',
      // Theme tooling: scripts/generate-tokens.mjs and scripts/contrast-check.ts.
      'scripts/**/*.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: false, project: false },
    },
  },

  /**
   * The raw-colour ban (THEME.md Phase 7 item 1).
   *
   * Every exemption below is a Phase 5 functional-colour case or a bootstrap
   * that runs before tokens.css exists. Each one is registered in
   * docs/FUNCTIONAL-COLOR.md; adding a file here without adding it there is how
   * the exemption list rots.
   */
  {
    files: ['client/src/**/*.{ts,tsx}'],
    ignores: [
      // E1 — literal wire colours. The user matches these against physical
      // wires on a breadboard; theming them makes the diagram wrong.
      'client/src/examples/builder.ts',
      // E4 — shipped example projects are saved user data.
      'client/src/examples/index.ts',
      // E2 — FRAME_COLORS is a user-facing picker, persisted per project.
      'client/src/graph/model.ts',
      'client/src/store/graphStore.ts',
      // E3 — widget colour defaults and their render-time fallbacks. Stored as
      // literal hex in the project file, so they cannot be theme-aware.
      'client/src/dashboard/model.ts',
      'client/src/dashboard/WidgetInspector.tsx',
      'client/src/dashboard/widgets/index.tsx',
      // E7 — <meta name="theme-color"> is read by browser chrome, which cannot
      // resolve a custom property. Mirrors the literals in index.html.
      'client/src/styles/theme.ts',
      // Not colour: NeoPixel node summaries render "rgb(255,0,0)" as label text
      // describing the value being written to the strip.
      'client/src/nodes/defs/components.ts',
      // Tests assert on specific token values on purpose.
      'client/src/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...NO_DEFAULT_PALETTE, ...NO_RAW_COLOR],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      // Tests reach into deliberately malformed shapes to prove the code
      // survives them; the type checker cannot help there and should not try.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
);
