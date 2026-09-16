/**
 * Schema + semantic validation of a DataAppSpec v2.
 *
 * Schema errors come from `spec/`. Semantic errors are what a schema cannot
 * say: that a recipe exists for this spec's family, that a bound measure or
 * dimension was declared, that a family's required roles resolve.
 *
 * Nothing here names a family, a metric or a recipe. What a family requires,
 * which metric names it adds, and how often a repeating dataset may appear
 * are all read from the catalogue — so a new family is a folder of JSON, not
 * an edit to this file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { datasetsFor, loadCatalogue, recipesFor, templateFor } from './catalogue.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const SCHEMA = JSON.parse(readFileSync(`${here}/../spec/dataapp-spec.v2.schema.json`, 'utf8'))

let compiled
function validator() {
  if (compiled === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false })
    addFormats(ajv)
    compiled = ajv.compile(SCHEMA)
  }
  return compiled
}

const familyOf = (spec) => (spec.family === undefined ? undefined : loadCatalogue().families[spec.family.kind])

/** Control kinds that only exist because some family provides them. */
function claimedControls() {
  return new Set(Object.values(loadCatalogue().families).flatMap((family) => family.control_kinds ?? []))
}

/** Walk a dotted path through a family's roles. */
const roleAt = (roles, path) => path.split('.').reduce((node, key) => node?.[key], roles)

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateSpec(spec) {
  const errors = []
  const check = validator()
  if (!check(spec)) {
    for (const error of check.errors ?? []) errors.push(`${error.instancePath || '/'} ${error.message}`)
    return { ok: false, errors }
  }

  if (templateFor(spec) === undefined) errors.push(`template "${spec.template}" is not in templates/`)
  const recipes = recipesFor(spec)
  const measureIds = new Set(spec.measures.map((measure) => measure.id))
  const dims = new Set(spec.dimensions.map((dimension) => dimension.field))
  const family = familyOf(spec)

  // Metric names a family adds. `measure` may be selected one at a time; `series` may also be charted alongside.
  const asMeasure = new Set(family?.metrics?.measure ?? [])
  const asSeries = new Set(family?.metrics?.series ?? family?.metrics?.measure ?? [])
  const okMeasure = (value) => asMeasure.has(value) || measureIds.has(value)
  const okSeries = (value) => asSeries.has(value) || measureIds.has(value)

  if (measureIds.size !== spec.measures.length) errors.push('/measures ids must be unique')
  if (spec.measures.filter((measure) => measure.role === 'primary').length > 1) errors.push('/measures at most one measure may be primary')

  if (spec.family !== undefined) {
    if (family === undefined) {
      errors.push(`/family kind "${spec.family.kind}" is not in families/`)
    } else {
      if (family.requires?.entity === true && spec.entity === undefined) errors.push(`/entity is required by the ${spec.family.kind} family`)
      if (family.requires?.arms === true && spec.family.arms?.field === undefined) errors.push(`/family/arms is required by the ${spec.family.kind} family`)
      for (const path of family.requires?.roles ?? []) {
        const id = roleAt(spec.family.roles, path)
        if (typeof id !== 'string' || !measureIds.has(id)) errors.push(`/family/roles/${path} is not a declared measure id`)
      }
    }
  }

  // A dataset that repeats costs one query per distinct bound value, so the declaration caps it.
  const repeats = datasetsFor(spec)
    .filter((dataset) => dataset.repeat !== undefined)
    .map((dataset) => ({ ...dataset.repeat, seen: new Set() }))

  spec.questions.forEach((question, index) => {
    const recipe = recipes[question.recipe]
    if (recipe === undefined) {
      errors.push(`/questions/${index} recipe "${question.recipe}" is not available for ${spec.family?.kind ?? 'core'} (have: ${Object.keys(recipes).join(', ')})`)
      return
    }
    for (const [key, value] of Object.entries(question.bind ?? {})) {
      const slot = recipe.bind?.[key]
      if (slot === undefined) {
        errors.push(`/questions/${index}/bind/${key} is not a binding of recipe "${question.recipe}" (allowed: ${Object.keys(recipe.bind ?? {}).join(', ') || 'none'})`)
        continue
      }
      if (slot.type === 'measure' && value !== 'ui' && value !== 'primary' && !okMeasure(value)) errors.push(`/questions/${index}/bind/${key} "${value}" is not a declared measure`)
      if (slot.type === 'measures' && value !== 'ui' && value !== 'all' && value !== 'primary' && (!Array.isArray(value) || value.some((measure) => !okSeries(measure)))) {
        errors.push(`/questions/${index}/bind/${key} must be "all", "primary" or an array of declared measures`)
      }
      if (slot.type === 'dim' && value !== 'ui' && value !== null && !dims.has(value)) errors.push(`/questions/${index}/bind/${key} "${value}" is not a declared dimension`)
      if (slot.type === 'dims' && value !== 'ui' && value !== 'all' && value !== 'first' && (!Array.isArray(value) || value.some((dimension) => !dims.has(dimension)))) {
        errors.push(`/questions/${index}/bind/${key} contains an undeclared dimension`)
      }
      for (const repeat of repeats) if (question.recipe === repeat.recipe && key === repeat.bind && typeof value === 'string') repeat.seen.add(value)
    }
  })
  for (const repeat of repeats) {
    const max = repeat.max ?? 3
    if (repeat.seen.size > max) errors.push(`at most ${max} "${repeat.recipe}" questions may bind a different ${repeat.bind} — each one costs a query`)
  }

  const claimed = claimedControls()
  const provided = new Set(family?.control_kinds ?? [])
  for (const control of spec.controls ?? []) {
    if (control.kind === 'measure' && Array.isArray(control.options) && control.options.some((measure) => !okMeasure(measure))) errors.push('/controls measure options must be declared measures')
    if (claimed.has(control.kind) && !provided.has(control.kind)) errors.push(`/controls "${control.kind}" needs a family that provides it`)
  }

  const blobNames = new Set((spec.store?.blobs ?? []).map((blob) => blob.name))
  if (blobNames.size !== (spec.store?.blobs ?? []).length) errors.push('/store/blobs names must be unique')
  const targetsBlob = spec.rules?.targets_blob
  if (targetsBlob !== undefined && !blobNames.has(targetsBlob)) errors.push(`/rules/targets_blob "${targetsBlob}" is not a declared blob in /store/blobs`)

  const columns = spec.measures.map((measure) => measure.column)
  if (new Set(columns).size !== columns.length) errors.push('/measures two measures bind the same column')
  for (const dimension of dims) if (columns.includes(dimension)) errors.push(`"${dimension}" is both a measure column and a dimension`)

  return { ok: errors.length === 0, errors }
}
