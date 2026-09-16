/**
 * Template + questions -> panels. Fills the defaults the interview may omit.
 */

import { loadCatalogue, recipesFor, templateFor } from './catalogue.mjs'

const familyOf = (spec) => (spec.family === undefined ? undefined : loadCatalogue().families[spec.family.kind])

/** @returns the spec with `panels`, `chrome`, `controls`, `rules`, `theme`, `words` filled in. */
export function resolveSpec(input) {
  const template = templateFor(input)
  if (template === undefined) throw new Error(`unknown template ${input.template}`)
  const recipes = recipesFor(input)
  const family = familyOf(input)

  const byRecipe = new Map()
  for (const question of input.questions) {
    const list = byRecipe.get(question.recipe) ?? []
    list.push(question)
    byRecipe.set(question.recipe, list)
  }

  const panels = []
  const used = new Set()
  for (const slot of template.slots) {
    const questions = byRecipe.get(slot.recipe) ?? []
    if (!slot.always && questions.length === 0) continue
    used.add(slot.recipe)
    const question = questions[0]
    const panel = { recipe: slot.recipe, bind: { ...(slot.bind ?? {}), ...(question?.bind ?? {}) } }
    if (question?.say) panel.say = question.say
    if (slot.width) panel.width = slot.width
    panels.push(panel)
  }
  for (const question of input.questions) {
    if (recipes[question.recipe] === undefined) continue
    // A recipe asked twice with different binds (two trends, two breakdowns) gets one panel per question.
    const already = panels.filter((panel) => panel.recipe === question.recipe)
    if (used.has(question.recipe) && already.some((panel) => JSON.stringify(panel.bind) === JSON.stringify({ ...(template.slots.find((slot) => slot.recipe === question.recipe)?.bind ?? {}), ...(question.bind ?? {}) }))) continue
    used.add(question.recipe)
    panels.push({ recipe: question.recipe, bind: { ...(question.bind ?? {}) }, say: question.say })
  }

  // A measure is named by its label; a metric a family derives is named by itself until the interview renames it.
  const defaultWords = {
    ...Object.fromEntries(input.measures.map((measure) => [measure.id, measure.label])),
    ...Object.fromEntries((family?.metrics?.series ?? []).map((metric) => [metric, metric])),
  }
  return {
    ...input,
    chrome: template.chrome,
    controls: (input.controls ?? template.controls ?? []).filter((control) => control.kind !== 'entity' || input.entity !== undefined),
    words: { ...defaultWords, ...(input.words ?? {}) },
    rules: { confidence_bar: '90%', min_bookers: 0, trim_quartile: true, compare_periods: 7, ...(input.rules ?? {}) },
    theme: { accent: 'blue', follow: 'system', ...(input.theme ?? {}) },
    panels,
  }
}

/** The one-screen executive derivation of any spec. */
export function briefOf(spec) {
  const family = familyOf(spec)
  const measure = family?.metrics?.measure?.[0] ?? (spec.measures.find((m) => m.role === 'primary') ?? spec.measures[0]).id
  const { panels: _panels, appId: _appId, ...rest } = spec
  return {
    ...rest,
    title: `${spec.title} — Brief`,
    persona: 'exec',
    template: 'brief',
    questions: [{ say: `Is ${spec.words?.[measure] ?? measure} on track?`, recipe: 'verdict', bind: { measure } }],
    controls: spec.entity === undefined ? [] : [{ kind: 'entity' }],
  }
}
