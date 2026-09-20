import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts'],
  /* Both formats. The overlay is React and most consumers are on a bundler
     that prefers ESM, but stylelens is also meant to be reachable from a
     Playwright or Node script that only has require(). */
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  /* React is a peer dependency and must never be bundled — two copies in one
     page breaks hooks, and the failure is a runtime error a long way from the
     cause. */
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
