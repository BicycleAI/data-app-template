#!/usr/bin/env node
/**
 * kit — compose Bicycle data apps from specs.
 *
 *   kit validate <spec.json>...              schema + semantic checks
 *   kit compose  <spec.json> [--out DIR] [--dry-run] [--upload-url URL] [--app-id ID]
 *   kit brief    <spec.json> [--out DIR]     derive the exec brief spec and compose it
 *   kit manifest <spec.json>                 print the derived bda.manifest.json
 *   kit extract  <app.js>                    print the spec embedded in a composed bundle
 *   kit diff     <a.json> <b.json> [--json]  typed diff between two specs, in words
 *   kit catalogue                            print recipes and templates as JSON
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildBundle, extractSpec } from './bundle.mjs'
import { loadCatalogue } from './catalogue.mjs'
import { diffSpecs } from './diff.mjs'
import { checkManifest, deriveManifest } from './manifest.mjs'
import { briefOf, narrowsBy, resolveSpec } from './resolve.mjs'
import { uploadBundle } from './upload.mjs'
import { validateSpec } from './validate.mjs'

const [, , command, ...rest] = process.argv
const flags = {}
const positional = []
for (let index = 0; index < rest.length; index += 1) {
  const arg = rest[index]
  if (arg.startsWith('--')) {
    const key = arg.slice(2)
    const next = rest[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      index += 1
    } else flags[key] = true
  } else positional.push(arg)
}

const readSpec = (path) => JSON.parse(readFileSync(path, 'utf8'))
const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/** Validate → resolve → manifest → bundle. Shared by compose and brief. */
async function composeSpec(spec, outDir) {
  const result = validateSpec(spec)
  if (!result.ok) fail(`spec is invalid:\n  - ${result.errors.join('\n  - ')}`)
  const resolved = resolveSpec(spec)
  const manifest = deriveManifest(resolved)
  const manifestErrors = checkManifest(manifest)
  if (manifestErrors.length > 0) fail(`derived manifest is invalid:\n  - ${manifestErrors.join('\n  - ')}`)
  const narrows = narrowsBy(resolved)
  if (flags['dry-run']) {
    process.stdout.write(`${JSON.stringify({ ok: true, appId: resolved.appId ?? null, panels: resolved.panels.map((panel) => panel.recipe), queries: manifest.queries.map((query) => query.id), slots: `${manifest.queries.length}/32`, ...(narrows === '' ? {} : { narrows }) }, null, 2)}\n`)
    return
  }
  const built = buildBundle(resolved, manifest, outDir)
  process.stdout.write(`${JSON.stringify({ ok: true, ...built, panels: resolved.panels.map((panel) => panel.recipe), slots: `${manifest.queries.length}/32`, ...(narrows === '' ? {} : { narrows }) }, null, 2)}\n`)
  if (narrows !== '') process.stdout.write(`${narrows}\n`)
  if (typeof flags['upload-url'] === 'string') {
    await uploadBundle(built.zip, flags['upload-url'])
    process.stdout.write(`uploaded. Now: dataapp_complete_upload(app_id, version, sha256="${built.sha256}", bytes=${built.bytes})\n`)
  }
}

switch (command) {
  case 'validate': {
    if (positional.length === 0) fail('usage: kit validate <spec.json>...')
    let failed = false
    for (const path of positional) {
      const result = validateSpec(readSpec(path))
      process.stdout.write(`${result.ok ? 'ok     ' : 'INVALID'} ${path}${result.ok ? '' : `\n  - ${result.errors.join('\n  - ')}`}\n`)
      failed ||= !result.ok
    }
    process.exit(failed ? 1 : 0)
    break
  }
  case 'compose': {
    const path = positional[0]
    if (path === undefined) fail('usage: kit compose <spec.json> [--out DIR] [--dry-run] [--upload-url URL] [--app-id ID]')
    const spec = readSpec(path)
    if (typeof flags['app-id'] === 'string') spec.appId = flags['app-id']
    const outDir = resolve(typeof flags.out === 'string' ? flags.out : `build/${path.replace(/.*\//, '').replace(/\.json$/, '')}`)
    await composeSpec(spec, outDir)
    break
  }
  case 'brief': {
    const path = positional[0]
    if (path === undefined) fail('usage: kit brief <spec.json> [--out DIR] [--app-id ID]')
    const spec = briefOf(readSpec(path))
    if (typeof flags['app-id'] === 'string') spec.appId = flags['app-id']
    const outDir = resolve(typeof flags.out === 'string' ? flags.out : `build/${path.replace(/.*\//, '').replace(/\.json$/, '')}-brief`)
    await composeSpec(spec, outDir)
    break
  }
  case 'manifest': {
    const path = positional[0]
    if (path === undefined) fail('usage: kit manifest <spec.json>')
    process.stdout.write(`${JSON.stringify(deriveManifest(resolveSpec(readSpec(path))), null, 2)}\n`)
    break
  }
  case 'extract': {
    const path = positional[0]
    if (path === undefined) fail('usage: kit extract <app.js>')
    process.stdout.write(`${JSON.stringify(extractSpec(readFileSync(path, 'utf8')), null, 2)}\n`)
    break
  }
  case 'diff': {
    if (flags.app !== undefined) fail('kit diff --app <appId> <b.json> is out of scope for this kit — it needs the service to look up a version by app id. Compare two spec files instead: kit diff a.json b.json')
    const [pathA, pathB] = positional
    if (pathA === undefined || pathB === undefined) fail('usage: kit diff <a.json> <b.json> [--json]')
    const specA = readSpec(pathA)
    const specB = readSpec(pathB)
    const resultA = validateSpec(specA)
    if (!resultA.ok) fail(`${pathA} is invalid:\n  - ${resultA.errors.join('\n  - ')}`)
    const resultB = validateSpec(specB)
    if (!resultB.ok) fail(`${pathB} is invalid:\n  - ${resultB.errors.join('\n  - ')}`)
    const { changes } = diffSpecs(specA, specB)
    if (flags.json) process.stdout.write(`${JSON.stringify({ changes }, null, 2)}\n`)
    else if (changes.length === 0) process.stdout.write('no changes\n')
    else for (const change of changes) process.stdout.write(`${change.text}\n`)
    break
  }
  case 'catalogue': {
    const { recipes, templates, families } = loadCatalogue()
    if (flags['json']) {
      process.stdout.write(`${JSON.stringify({ recipes, templates, families }, null, 2)}\n`)
    } else {
      // Print recipes with explains
      for (const [family, familyRecipes] of Object.entries(recipes)) {
        process.stdout.write(`\n${family.toUpperCase()}\n`)
        process.stdout.write(`${'='.repeat(40)}\n`)
        for (const [id, recipe] of Object.entries(familyRecipes)) {
          process.stdout.write(`\n${recipe.name} (${id})\n`)
          if (recipe.explain) {
            process.stdout.write(`  ${recipe.explain}\n`)
          }
        }
      }
      process.stdout.write(`\n`)
    }
    break
  }
  default:
    fail('usage: kit <validate|compose|brief|manifest|extract|diff|catalogue> ...')
}
