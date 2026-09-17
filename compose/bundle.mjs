/**
 * Spec + prebuilt runtime -> bundle.zip.
 *
 * No compile step: the runtime is built once (`npm run build`), and each app
 * is that bundle with one line prepended that carries its spec.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

export function runtimeDir() {
  return process.env.KIT_RUNTIME_DIST ?? `${root}/runtime/dist`
}

/**
 * Prepends the spec (line 1) and, when given, the declared queries (line 2)
 * to the prebuilt runtime bundle. `queries` is optional so a caller that only
 * ever wanted the spec line keeps working unchanged.
 *
 * Line 2's shape is a contract shared byte-for-byte with the API repo's
 * Python port (`json.dumps(..., separators=(",", ":"))` there): each query is
 * reduced to `{ id, sql, parameters }` — dropping `columns`/`maxLimit` — with
 * `parameters` entries left exactly as `datasets.mjs` produced them
 * (`{name, type, required, default?}`), and no pretty-printing.
 */
export function injectSpec(appJs, spec, queries) {
  // JSON is valid JS; `<` is escaped so the payload can never close a script tag if inlined elsewhere.
  const json = JSON.stringify(spec).replaceAll('<', '\\u003c')
  const specLine = `window.__DATA_APP_SPEC=${json};\n`
  if (queries === undefined) return `${specLine}${appJs}`
  const queriesJson = JSON.stringify(queries.map(({ id, sql, parameters }) => ({ id, sql, parameters }))).replaceAll('<', '\\u003c')
  return `${specLine}window.__DATA_APP_QUERIES=${queriesJson};\n${appJs}`
}

/**
 * @returns {{ dir: string, zip: string, sha256: string, bytes: number, files: string[] }}
 */
export function buildBundle(spec, manifest, outDir) {
  const dist = runtimeDir()
  for (const name of ['app.js', 'app.css']) {
    if (!existsSync(`${dist}/${name}`)) throw new Error(`${dist}/${name} is missing. Run \`npm run build\` first (or set KIT_RUNTIME_DIST).`)
  }
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(`${outDir}/app.js`, injectSpec(readFileSync(`${dist}/app.js`, 'utf8'), spec, manifest.queries))
  writeFileSync(`${outDir}/app.css`, readFileSync(`${dist}/app.css`))
  writeFileSync(`${outDir}/bda.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(`${outDir}/spec.json`, `${JSON.stringify(spec, null, 2)}\n`)

  const zip = `${outDir}.zip`
  rmSync(zip, { force: true })
  execFileSync('zip', ['-q', '-X', zip, 'bda.manifest.json', 'app.js', 'app.css'], { cwd: outDir })
  const data = readFileSync(zip)
  return { dir: outDir, zip, sha256: createHash('sha256').update(data).digest('hex'), bytes: statSync(zip).size, files: ['bda.manifest.json', 'app.js', 'app.css'] }
}

/**
 * Read a spec back out of a composed app.js (first line).
 *
 * Deliberately only ever sees line 1: `.` does not span `\n` without the `s`
 * flag, and `JSON.stringify` never emits a raw newline (control characters
 * are escaped), so `(.*)` stops exactly at the end of the spec line and the
 * `window.__DATA_APP_QUERIES=` line that follows it is never captured.
 */
export function extractSpec(appJs) {
  const match = /^window\.__DATA_APP_SPEC=(.*);\n/.exec(appJs)
  if (match === null) throw new Error('this app.js was not produced by the composer')
  return JSON.parse(match[1])
}
