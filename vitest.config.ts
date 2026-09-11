import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Kept separate from vite.config.ts: `defineConfig` there has no `test` key,
// and the dev/build config should not carry test settings anyway.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }),
)
