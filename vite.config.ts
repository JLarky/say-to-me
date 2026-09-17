import { defineConfig, lazyPlugins } from 'vite-plus'

const agentIgnorePatterns = [
  '.agent/**',
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.continue/**',
  '.cursor/**',
  '.gemini/**',
  '.opencode/**',
  '.pi/**',
  '.roo/**',
  '.windsurf/**',
  '.github/**',
  'tools/oxlint/anti-slop/**',
  'src/modules/counter/dist/**',
]

export default defineConfig({
  publicDir: false,
  plugins: lazyPlugins(async () => {
    const { default: solid } = await import('vite-plugin-solid')

    return [solid()]
  }),
  build: {
    lib: {
      entry: 'src/modules/counter/counter.tsx',
      formats: ['es'],
      fileName: () => 'counter.js',
    },
    outDir: 'src/modules/counter/dist',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    ignorePatterns: agentIgnorePatterns,
    singleQuote: true,
    semi: false,
  },
  // Lint rules live here (formerly oxlint.config.ts). Vite+ `vp check` / CI use this block.
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [...agentIgnorePatterns, 'src/**/*.tsx'],
    jsPlugins: [
      { name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
      {
        name: 'anti-slop-effect',
        specifier: './tools/oxlint/anti-slop/effect/index.ts',
      },
    ],
    rules: {
      'oxc/no-accumulating-spread': 'error',
      'anti-slop/no-array-filter-map': 'error',
      'anti-slop/no-reduce-accumulator-copy': 'error',
      'anti-slop/no-broad-type-assertion': 'error',
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-json-parse': 'error',
      'anti-slop/no-schema-json': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': 'error',
      'anti-slop/no-shape-in-symbol-names': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-readable-spacing': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'anti-slop-effect/no-manual-effect-error-tag': 'error',
      'anti-slop-effect/no-manual-tag-comparison': 'error',
      'anti-slop-effect/no-manual-tagged-construction': 'error',
      'anti-slop-effect/no-service-constructor-imports': 'error',
      'anti-slop-effect/prefer-effect-match': 'error',
    },
    overrides: [
      {
        files: ['**/*.test.ts'],
        rules: {
          // node:test's describe/it return Promise<void> in @types/node.
          'typescript/no-floating-promises': 'off',
        },
      },
    ],
  },
})
