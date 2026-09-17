import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The build contract.
 *
 * The output names are fixed — `app.js` and `app.css`, no hashes, one file
 * each. The manifest an agent submits names them, and the embed page loads them
 * by those names, so they cannot vary per build. `scripts/assert-dist.mjs`
 * fails the build if they ever do.
 *
 * Everything is inlined: one JS file, one CSS file, and no separate assets.
 * The embed page's CSP allows `data:` images but no other subresource, so a
 * bundle that emitted a `.svg` next to itself would simply not load.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
    // `npm run dev` talks to the local service, so the studio client's
    // relative /api calls reach it without CORS.
    proxy: { '/api': 'http://localhost:8099' },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
