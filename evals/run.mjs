/**
 * Pins the composer's derived manifests for the example specs. The Python
 * toolset must produce byte-identical query SQL; regenerate with --update
 * only when the derivation changes on purpose.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deriveManifest } from '../compose/manifest.mjs'
import { resolveSpec } from '../compose/resolve.mjs'
import { validateSpec } from '../compose/validate.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const update = process.argv.includes('--update')
const goldenPath = `${root}/evals/manifest.golden.json`
const golden = update ? {} : JSON.parse(readFileSync(goldenPath, 'utf8'))
let failed = false

for (const file of readdirSync(`${root}/spec/examples`).filter((name) => name.endsWith('.json')).sort()) {
  const spec = JSON.parse(readFileSync(`${root}/spec/examples/${file}`, 'utf8'))
  const result = validateSpec(spec)
  if (!result.ok) {
    process.stdout.write(`INVALID ${file}: ${result.errors.join('; ')}\n`)
    failed = true
    continue
  }
  const resolved = resolveSpec(spec)
  const manifest = deriveManifest(resolved)
  const actual = {
    panels: resolved.panels.map((panel) => panel.recipe),
    queries: Object.fromEntries(manifest.queries.map((query) => [query.id, query.sql])),
    // Pinned for the same reason as the SQL: the service ports this derivation, and a
    // filter whose slots drift is a share link and a schedule that bind the wrong thing.
    controls: manifest.controls,
  }
  if (update) golden[file] = actual
  else if (JSON.stringify(golden[file]) !== JSON.stringify(actual)) {
    process.stdout.write(`DRIFT   ${file}\n  expected ${JSON.stringify(golden[file])}\n  actual   ${JSON.stringify(actual)}\n`)
    failed = true
  } else process.stdout.write(`ok      ${file}\n`)
}
if (update) {
  writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`)
  process.stdout.write('golden updated\n')
}
process.exit(failed ? 1 : 0)
