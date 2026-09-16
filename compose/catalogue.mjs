/** Reads every recipe.json (core and per family), template and family.json once. */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function readRecipes(dir, family) {
  const out = {}
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = `${dir}/${entry.name}/recipe.json`
    if (!existsSync(file)) continue
    out[entry.name] = { ...JSON.parse(readFileSync(file, 'utf8')), family }
  }
  return out
}

let cache
/**
 * @returns {{ recipes: object, datasets: object, templates: object, families: object, root: string }}
 */
export function loadCatalogue() {
  if (cache !== undefined) return cache
  const recipes = { core: readRecipes(`${root}/recipes`, 'core') }
  const datasets = { core: JSON.parse(readFileSync(`${root}/recipes/datasets.json`, 'utf8')) }
  const families = {}
  if (existsSync(`${root}/families`)) {
    for (const entry of readdirSync(`${root}/families`, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = `${root}/families/${entry.name}/family.json`
      if (!existsSync(file)) continue
      families[entry.name] = JSON.parse(readFileSync(file, 'utf8'))
      recipes[entry.name] = readRecipes(`${root}/families/${entry.name}/recipes`, entry.name)
      const declared = `${root}/families/${entry.name}/datasets.json`
      if (existsSync(declared)) datasets[entry.name] = JSON.parse(readFileSync(declared, 'utf8'))
    }
  }
  const templates = {}
  for (const entry of readdirSync(`${root}/templates`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    templates[entry.name] = {}
    for (const file of readdirSync(`${root}/templates/${entry.name}`)) {
      if (!file.endsWith('.json')) continue
      const template = JSON.parse(readFileSync(`${root}/templates/${entry.name}/${file}`, 'utf8'))
      templates[entry.name][template.id] = template
    }
  }
  cache = { recipes, datasets, templates, families, root }
  return cache
}

/** The recipe catalogue a spec can draw on: core plus its family's. */
export function recipesFor(spec) {
  const { recipes } = loadCatalogue()
  const family = spec.family?.kind
  return family === undefined ? recipes.core : { ...recipes.core, ...(recipes[family] ?? {}) }
}

/**
 * The datasets a spec may pull: the core set, or a family's when it declares
 * `replaces_core` (an experiment is read per arm, not per row).
 */
export function datasetsFor(spec) {
  const { datasets } = loadCatalogue()
  const family = spec.family?.kind
  const declared = family === undefined ? undefined : datasets[family]
  if (declared === undefined) return datasets.core.datasets
  if (declared.replaces_core === true) return declared.datasets
  return [...datasets.core.datasets, ...declared.datasets]
}

export function templateFor(spec) {
  const { templates } = loadCatalogue()
  const family = spec.family?.kind ?? 'core'
  return templates[family]?.[spec.template] ?? templates.core?.[spec.template]
}
