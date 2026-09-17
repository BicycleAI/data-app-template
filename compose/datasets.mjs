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
 *     "maxLimit": 10000,
 *     "filters": true                         // append the spec's filter controls to the WHERE
 *   }
 *
 * Substitutions — scalars: model, time, grain, entity, entity_rank, primary,
 * arm, each, each_slug, and `role:<path>` (a role the spec's
 * family declares, resolved through the spec's measure ids). Lists: measures, dimensions, entity_fields,
 * context. A `select` entry that is exactly one list token expands to its
 * items; anything else is a literal with scalars substituted in. The finished
 * list drops empties and duplicates, so an absent optional field leaves no
 * hole behind.
 *
 * ## Filters
 *
 * A `{ "kind": "filter", "dim": <declared dimension> }` control narrows the app.
 * Which SQL form that becomes was settled by compiling and *running* four
 * candidates against a real model (see the T3.1 commit message):
 *
 *   (a) `AND <dim> = :v`                    compiles yes   runs yes (correct rows)
 *   (b) `AND <dim> IN (:vs)`  list param    compiles yes   runs NO  -- 0 rows, silently.
 *       The compiler folds the list into a nested argument
 *       (`filter('<dim>', Comparator.IN, [['a','b']])`), so the predicate
 *       matches nothing. It fails as an empty result, not as an error.
 *       Independently unusable anyway: the service's manifest contract
 *       (`data_apps/manifest.py`, `QueryParameter.type`) allows only
 *       `string | number | boolean | date` -- there is no list parameter type
 *       to declare, so (b) could never reach a manifest.
 *   (c) `AND <dim> IN ('a','b')` literals   compiles yes   runs yes (correct rows)
 *   (d) `AND <dim> IN (:v_0, :v_1)`         compiles yes   runs yes (correct rows)
 *       -- one *scalar* string parameter per slot.
 *
 * Filters render as form (d). (c) works too, but it bakes the values at compose
 * time, which makes the control cosmetic for exactly the queries that need it:
 * `totals` and `by_time` aggregate the dimension away, so if their SQL is fixed
 * the viewer's pick can never reach them. (d) keeps the values in parameters,
 * so the app re-runs the query when the pick changes.
 *
 * The cost of (d) is a fixed arity, chosen at compose time:
 *
 *   slots = control.slots ?? min(control.options.length, 5), hard cap 5;
 *   a single-select filter (`multi` not true) is always 1 slot.
 *
 * One slot renders `= :<slug>_0` rather than a one-element `IN`. Each slot is
 * declared `{ name, type: "string", required: true, default }`, the defaults
 * coming from the control's `default` (or all its `options` when it has none),
 * so a composed manifest is runnable as it stands.
 *
 * Fixed arity needs two conventions, and T3.3's FilterBar owns both:
 *
 *   - Fewer values picked than slots: the runtime repeats the last picked value
 *     into the spare slots. `IN` is a set, so duplicates change nothing --
 *     verified by running `IN (:c0, :c1, :c2, :c3, :c4)` with one value
 *     repeated four times and getting the same rows as the two-value query.
 *   - More values picked than slots: `totals` and `by_time` stay unnarrowed,
 *     and the FilterBar says so rather than showing a number that quietly
 *     answers a different question.
 *
 * `options` stays in the spec and out of the SQL: it is the chip list the
 * viewer picks from (T3.4 fills it from the dimension's real values), and it
 * reaches the query only as the source of the slot count and the defaults. A
 * filter with neither `options` nor a `default` has no value to seed a slot
 * with, so it contributes no clause until one of them is set.
 *
 * Which datasets get the clause is declared, not inferred. A dataset that
 * already SELECTs the dimension (`by_dimension`, `by_time_<dim>`, `segments`)
 * returns the rows to narrow client-side and must stay unfiltered, or the
 * breakdown would lose the values the viewer is choosing between. A dataset
 * that aggregates the dimension away (`totals`, `by_time`, `arm_totals`,
 * `daily_trend`) cannot be narrowed after the fact, so it declares
 * `"filters": true`.
 *
 * Slots are not free: a query may declare at most 16 parameters, and `from`
 * and `to` (and `entity`) are already spent. `compose/validate.mjs` fails the
 * spec with the arithmetic rather than letting the service reject the upload.
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

function parametersOf(dataset, spec, filters) {
  const dates = [
    { name: 'from', type: 'date', required: true },
    { name: 'to', type: 'date', required: true },
  ]
  const slots = filters.flatMap((filter) => filter.parameters)
  if (dataset.params !== 'entity' || spec.entity === undefined) return [...dates, ...slots]
  return [{ name: 'entity', type: spec.entity.type ?? 'number', required: true }, ...dates, ...slots]
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

const MAX_SLOTS = 5
const slug = (field) => field.toLowerCase().replace(/[^a-z0-9_]/g, '_')

/**
 * How many parameter slots a filter gets. See `## Filters`.
 *
 * `seed` is what the slots are pre-filled with, and it is the fallback when the
 * control has no `options` yet (T3.4 fills those in) — otherwise a filter whose
 * default names three values would render one slot and silently drop two.
 */
function slotsOf(control, seed) {
  if (control.multi !== true) return 1
  const fromOptions = Math.min((control.options ?? []).length, MAX_SLOTS)
  const fallback = fromOptions === 0 ? Math.min(seed.length, MAX_SLOTS) : fromOptions
  return Math.min(MAX_SLOTS, Math.max(1, control.slots ?? fallback))
}

/**
 * Every declared filter, resolved into the slots it renders: the clause it
 * contributes and one scalar string parameter per slot, pre-filled so a
 * composed manifest is runnable as it stands.
 *
 * Exported because `validate.mjs` has to count the parameters against the
 * manifest's limit of 16, and must count exactly what this renders.
 */
export function filtersOf(spec) {
  const declared = new Set(spec.dimensions.map((dimension) => dimension.field))
  const filters = []
  for (const control of spec.controls ?? []) {
    if (control.kind !== 'filter') continue
    if (!declared.has(control.dim)) throw new Error(`filter control narrows "${control.dim}", which is not a declared dimension`)
    // `options` is the chip list; it reaches the SQL only as the slot count and the seeded defaults.
    const seed = (control.default === undefined ? (control.options ?? []) : [control.default].flat()).map((value) => String(value))
    if (seed.length === 0) continue
    const slots = slotsOf(control, seed)
    // Spare slots repeat the last value — `IN` is a set, so duplicates are a no-op.
    const values = Array.from({ length: slots }, (_, index) => seed[Math.min(index, seed.length - 1)])
    const names = values.map((_, index) => `${slug(control.dim)}_${index}`)
    filters.push({
      dim: control.dim,
      clause: names.length === 1 ? ` AND ${control.dim} = :${names[0]}` : ` AND ${control.dim} IN (${names.map((name) => `:${name}`).join(', ')})`,
      parameters: names.map((name, index) => ({ name, type: 'string', required: true, default: values[index] })),
    })
  }
  return filters
}

function render(dataset, spec, each) {
  const ctx = context(spec, each)
  const select = expand(dataset.select, ctx, spec).join(', ')
  const filters = dataset.filters === true ? filtersOf(spec) : []
  const where = `${ctx.where[dataset.where ?? 'entity']}${filters.map((filter) => filter.clause).join('')}`
  const order = dataset.order === undefined ? '' : ` ORDER BY ${fill(dataset.order, ctx, spec)}`
  const limit = dataset.limit === undefined ? '' : ` LIMIT ${dataset.limit}`
  return {
    id: fill(dataset.id, ctx, spec),
    sql: `SELECT ${select} FROM ${ctx.scalars.model} WHERE ${where}${order}${limit}`,
    parameters: parametersOf(dataset, spec, filters),
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
