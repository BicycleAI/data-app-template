import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Kept separate from `runtime/vite.config.ts`: that config scopes `root` to
 * `runtime/` for the app build, but tests span `evals/`, `recipes/` and
 * `families/` too, and the test runner needs no `root` at all.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['evals/**/*.test.tsx', 'runtime/src/**/*.test.ts', 'runtime/src/**/*.test.tsx'],
  },
})
