/**
 * Queries are declared, not coded.
 *
 * `recipes/datasets.json` (core) and `families/<kind>/datasets.json` declare
 * every dataset an app can pull. This module renders them. It knows how to
 * expand a substitution and nothing about what any dataset means — so adding
 * a family, or changing a query, is a change to JSON in this repo and never a
 * change to the service that composes.
 *
 * A dataset:
 *
 *   {
 *     "id":      "by_dimension",              // or a template: "by_time_{{each_slug}}"
 *     "when":    "dimensions",                // omit | "entity" | "dimensions"
 *     "repeat":  { "over": "panel_bind", "recipe": "trend", "bind": "by", "max": 3 },
 *     "select":  ["{{dimensions}}", "{{measures}}"],
 *     "where":   "entity",                    // "entity" (entity + range) | "range"
 *     "params":  "entity",                    // "entity" (entity + dates) | "range" (dates)
 *     "order":   "{{primary}} DESC",
 *     "limit":   10000,
 *     "columns": [{ "list": "dimensions", "type": "string" }, { "list": "measures", "type": "number" }],
 *     "maxLimit": 10000
 *   }
 *
 * Substitutions — scalars: model, time, grain, entity, entity_rank, primary,
 * arm, each, each_slug, and `role:<path>` (a role the spec's
 * family declares, resolved through the spec's measure ids). Lists: measures, dimensions, entity_fields,
 * context. A `select` entry that is exactly one list token expands to its
 * items; anything else is a literal with scalars substituted in. The finished
 * list drops empties and duplicates, so an absent optional field leaves no
 * hole behind.
 */

const TIME_DEFAULT = 'timestamp'
const TOKEN = /\{\{([a-z_]+(?::[a-z_.]+)?)\}\}/g
const SOLO = /^\{\{([a-z_]+(?::[a-z_.]+)?)\}\}$/

function columnOfMeasure(spec, id) {
  const measure = spec.measures.find((candidate) => candidate.id === id)
  if (measure === undefined) throw new Error(`dataset references unknown measure id "${id}"`)
  return measure.column
}

function columnOfRole(spec, path) {
  let node = spec.family?.roles
  for (const key of path.split('.')) node = node?.[key]
  if (typeof node !== 'string') throw new Error(`dataset references unknown role "${path}"`)
  return columnOfMeasure(spec, node)
}

function context(spec, each) {
  const time = spec.time.column ?? TIME_DEFAULT
  const entity = spec.entity
  const range = `${time} >= :from AND ${time} < :to`
  const list = entity?.list
  const measures = spec.measures.map((measure) => measure.column)
  return {
    scalars: {
      model: spec.model,
      time,
      grain: spec.time.grain ?? 'day',
      entity: entity?.field ?? '',
      entity_rank: list?.rank ?? measures[0],
      primary: (spec.measures.find((measure) => measure.role === 'primary') ?? spec.measures[0]).column,
      arm: spec.family?.arms?.field ?? '',
      each: each ?? '',
      each_slug: each === undefined ? '' : each.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    },
    lists: {
      measures,
      dimensions: spec.dimensions.map((dimension) => dimension.field),
      entity_fields: [list?.label, list?.description, list?.status, list?.group, list?.end],
      context: Object.values(spec.family?.context ?? {}),
    },
    where: { entity: entity === undefined ? range : `${entity.field} = :entity AND ${range}`, range },
  }
}

function resolve(name, ctx, spec) {
  if (name.startsWith('role:')) return columnOfRole(spec, name.slice(5))
  if (name in ctx.scalars) return ctx.scalars[name]
  if (name in ctx.lists) return ctx.lists[name]
  throw new Error(`unknown substitution {{${name}}}`)
}

const fill = (text, ctx, spec) => text.replace(TOKEN, (_, name) => String(resolve(name, ctx, spec)))

function expand(entries, ctx, spec) {
  const out = []
  for (const entry of entries) {
    const solo = SOLO.exec(entry)
    const value = solo === null ? fill(entry, ctx, spec) : resolve(solo[1], ctx, spec)
    if (Array.isArray(value)) out.push(...value)
    else out.push(value)
  }
  return [...new Set(out.filter((name) => name !== undefined && name !== ''))]
}

function columnsOf(dataset, ctx, spec) {
  const entityType = spec.entity?.type ?? 'number'
  const out = []
  for (const column of dataset.columns ?? []) {
    const type = column.type === 'entity' ? entityType : column.type
    if (column.list !== undefined) {
      for (const name of ctx.lists[column.list].filter((name) => name !== undefined && name !== '')) out.push({ name, type })
    } else if (column.token !== undefined) {
      out.push({ name: String(resolve(column.token, ctx, spec)), type })
    } else {
      out.push({ name: column.name, type })
    }
  }
  return out
}

function parametersOf(dataset, spec) {
  const dates = [
    { name: 'from', type: 'date', required: true },
    { name: 'to', type: 'date', required: true },
  ]
  if (dataset.params !== 'entity' || spec.entity === undefined) return dates
  return [{ name: 'entity', type: spec.entity.type ?? 'number', required: true }, ...dates]
}

function applies(dataset, spec) {
  if (dataset.when === 'entity') return spec.entity !== undefined
  if (dataset.when === 'dimensions') return spec.dimensions.length > 0
  return true
}

/** Distinct values a panel binds, for a dataset that repeats once per value. */
function repeatValues(dataset, spec) {
  const { over, recipe, bind, max = 3 } = dataset.repeat
  if (over !== 'panel_bind') throw new Error(`unknown repeat source "${over}"`)
  const fields = new Set(spec.dimensions.map((dimension) => dimension.field))
  const panels = spec.panels ?? spec.questions
  const values = panels.filter((panel) => panel.recipe === recipe).map((panel) => panel.bind?.[bind])
  return [...new Set(values.filter((value) => typeof value === 'string' && fields.has(value)))].slice(0, max)
}

function render(dataset, spec, each) {
  const ctx = context(spec, each)
  const select = expand(dataset.select, ctx, spec).join(', ')
  const where = ctx.where[dataset.where ?? 'entity']
  const order = dataset.order === undefined ? '' : ` ORDER BY ${fill(dataset.order, ctx, spec)}`
  const limit = dataset.limit === undefined ? '' : ` LIMIT ${dataset.limit}`
  return {
    id: fill(dataset.id, ctx, spec),
    sql: `SELECT ${select} FROM ${ctx.scalars.model} WHERE ${where}${order}${limit}`,
    parameters: parametersOf(dataset, spec),
    columns: columnsOf(dataset, ctx, spec),
    maxLimit: dataset.maxLimit,
  }
}

/** Every declared dataset that applies to this spec, in declaration order. */
export function renderDatasets(spec, datasets) {
  const queries = []
  for (const dataset of datasets) {
    if (!applies(dataset, spec)) continue
    if (dataset.repeat === undefined) queries.push(render(dataset, spec))
    else for (const each of repeatValues(dataset, spec)) queries.push(render(dataset, spec, each))
  }
  return queries
}
