/**
 * The build contract, enforced.
 *
 * A bundle whose entry is `app-D4f8.js` uploads fine, publishes fine, and then
 * renders nothing — the embed page asked for `app.js`. Failing here, in the
 * agent's own build, is the only place that mistake is cheap to fix.
 */

import { readdir } from 'node:fs/promises'

const REQUIRED = ['app.js', 'app.css']
/** Vite writes this for its own dev/preview use; nothing submits it. */
const IGNORED = new Set(['index.html', '.vite'])

const present = (
  await readdir(process.argv[2] ?? 'dist').catch(() => {
    process.stderr.write('dist/ is missing — did the build run?\n')
    process.exit(1)
  })
).filter((name) => !IGNORED.has(name))

const missing = REQUIRED.filter((name) => !present.includes(name))
const unexpected = present.filter((name) => !REQUIRED.includes(name))

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) process.stderr.write(`dist/ is missing: ${missing.join(', ')}\n`)
  if (unexpected.length > 0) {
    process.stderr.write(
      `dist/ has files the embed page will not load: ${unexpected.join(', ')}\n` +
        'The build must emit exactly app.js and app.css. Do not change the output\n' +
        'names in vite.config.ts, and inline assets rather than emitting them.\n',
    )
  }
  process.exit(1)
}

process.stdout.write(`dist/ is valid: ${REQUIRED.join(', ')}\n`)
