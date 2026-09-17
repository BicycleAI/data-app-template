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

export function injectSpec(appJs, spec) {
  // JSON is valid JS; `<` is escaped so the payload can never close a script tag if inlined elsewhere.
  const json = JSON.stringify(spec).replaceAll('<', '\\u003c')
  return `window.__DATA_APP_SPEC=${json};\n${appJs}`
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
  writeFileSync(`${outDir}/app.js`, injectSpec(readFileSync(`${dist}/app.js`, 'utf8'), spec))
  writeFileSync(`${outDir}/app.css`, readFileSync(`${dist}/app.css`))
  writeFileSync(`${outDir}/bda.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(`${outDir}/spec.json`, `${JSON.stringify(spec, null, 2)}\n`)

  const zip = `${outDir}.zip`
  rmSync(zip, { force: true })
  execFileSync('zip', ['-q', '-X', zip, 'bda.manifest.json', 'app.js', 'app.css'], { cwd: outDir })
  const data = readFileSync(zip)
  return { dir: outDir, zip, sha256: createHash('sha256').update(data).digest('hex'), bytes: statSync(zip).size, files: ['bda.manifest.json', 'app.js', 'app.css'] }
}

/** Read a spec back out of a composed app.js (first line). */
export function extractSpec(appJs) {
  const match = /^window\.__DATA_APP_SPEC=(.*);\n/.exec(appJs)
  if (match === null) throw new Error('this app.js was not produced by the composer')
  return JSON.parse(match[1])
}
