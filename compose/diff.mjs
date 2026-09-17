/**
 * Typed diff between two DataAppSpecs.
 *
 * Versions of an app are versions of its spec, so a person should see a diff
 * as panel-level changes in words ("added *Refunds by city* below the
 * ranking", "trend now weekly", "confidence bar 95% -> 90%"), never as JSON.
 * `diffSpecs` is the one statement of that; `kit diff` and the Python
 * service's `GET /versions/{a}/diff/{b}` both produce its `{ changes }`
 * shape, and the host renders `change.text`. See README's `## Diff` for the
 * `Change` contract and one example per `kind` — the Python port copies
 * that section verbatim, so a new `kind` or a reworded template is a change
 * to this file *and* that section together.
 *
 * Both specs are run through `resolveSpec` first (so template slots and
 * catalogue defaults are accounted for) and then through a small
 * `normalize` step that fills the schema defaults `validate.mjs` does not
 * materialize (ajv runs with `useDefaults: false`). Without that, an
 * unspecified `time.grain` (schema default `"day"`) would diff against an
 * explicit `"day"` as a change, even though the two specs mean the same
 * thing.
 */

import { loadCatalogue, recipesFor } from './catalogue.mjs'
import { resolveSpec } from './resolve.mjs'

// ---------------------------------------------------------------------------
// Normalization — fill schema defaults resolveSpec does not, so equivalent
// specs (one explicit, one relying on a default) diff as identical.
// ---------------------------------------------------------------------------

function normalize(spec) {
  const out = { ...spec }
  out.time = { column: 'timestamp', grain: 'day', ...spec.time }
  out.measures = spec.measures.map((measure) => ({ format: 'number', good: 'up', role: 'secondary', ...measure }))
  if (spec.entity !== undefined) out.entity = { type: 'number', ...spec.entity }
  if (spec.family?.kind === 'ab_test') out.family = { ...spec.family, arms: { exclude: ['CONTROL'], ...spec.family.arms } }
  if (spec.chat !== undefined) out.chat = { anchors: ['panel'], ...spec.chat }
  return out
}

// ---------------------------------------------------------------------------
// Vocabulary — the spec's own words, never a raw id in generated text.
// ---------------------------------------------------------------------------

const wordOf = (spec, id) => spec.words?.[id] ?? id
const dimLabelOf = (spec, field) => spec.dimensions.find((dimension) => dimension.field === field)?.label ?? field

const FORMAT_WORDS = { number: 'a number', currency: 'currency', percent: 'a percent', rate: 'a rate' }
const formatWord = (format) => FORMAT_WORDS[format] ?? format
const GRAIN_WORDS = { day: 'daily', week: 'weekly', month: 'monthly' }
const grainWord = (grain) => GRAIN_WORDS[grain] ?? grain
const PERSONA_WORDS = { biz: 'the business owner', pm: 'the PM', analyst: 'the analyst', exec: 'the exec' }
const personaWord = (persona) => PERSONA_WORDS[persona] ?? persona

function dimText(spec, value) {
  if (value === undefined) return undefined
  if (value === null) return 'nothing'
  if (value === 'ui') return 'the picked dimension'
  return dimLabelOf(spec, value)
}
function dimsText(spec, value) {
  if (value === undefined) return undefined
  if (value === 'ui') return 'the picked dimensions'
  if (value === 'all') return 'every dimension'
  if (value === 'first') return 'the first dimension'
  if (Array.isArray(value)) return value.map((field) => dimLabelOf(spec, field)).join(' and ')
  return String(value)
}
function measureText(spec, value) {
  if (value === undefined) return undefined
  if (value === 'ui') return 'the picked measure'
  if (value === 'primary') return 'the primary measure'
  return wordOf(spec, value)
}
function measuresText(spec, value) {
  if (value === undefined) return undefined
  if (value === 'ui') return 'the picked measures'
  if (value === 'primary') return 'the primary measure'
  if (value === 'all') return 'every measure'
  if (Array.isArray(value)) return value.map((id) => wordOf(spec, id)).join(' and ')
  return String(value)
}
function valueText(spec, type, value) {
  if (type === 'dim') return dimText(spec, value)
  if (type === 'dims') return dimsText(spec, value)
  if (type === 'measure') return measureText(spec, value)
  if (type === 'measures') return measuresText(spec, value)
  if (value === undefined) return undefined
  return Array.isArray(value) ? value.join(', ') : String(value)
}
const display = (text, value) => text ?? (value === undefined ? 'none' : JSON.stringify(value))

// ---------------------------------------------------------------------------
// Generic ordered-list matching: identity present in both -> matched
// (handlers.matched), only in `b` -> added, only in `a` -> removed. Emits
// matched/added in `b`'s order, then leftover removals in `a`'s order — the
// "panel order" (and measure/dimension/control order) the spec calls for.
// ---------------------------------------------------------------------------

function diffOrderedList(itemsA, itemsB, identityOfA, identityOfB, handlers) {
  const changes = []
  const consumed = new Array(itemsA.length).fill(false)
  const indexByIdA = new Map()
  itemsA.forEach((item, index) => {
    const id = identityOfA(item, index)
    indexByIdA.set(id, [...(indexByIdA.get(id) ?? []), index])
  })
  itemsB.forEach((itemB, indexB) => {
    const id = identityOfB(itemB, indexB)
    const candidates = indexByIdA.get(id) ?? []
    const indexA = candidates.find((index) => !consumed[index])
    if (indexA !== undefined) {
      consumed[indexA] = true
      changes.push(...handlers.matched(itemsA[indexA], indexA, itemB, indexB))
    } else {
      changes.push(...handlers.added(itemB, indexB))
    }
  })
  itemsA.forEach((itemA, indexA) => {
    if (!consumed[indexA]) changes.push(...handlers.removed(itemA, indexA))
  })
  return changes
}

// ---------------------------------------------------------------------------
// Panels — identity is the recipe, plus (only when the recipe repeats
// within one spec) the bind key that a core or family datasets.json
// declares as that recipe's repeat key (e.g. trend's `by` — see
// `by_time_{{each_slug}}`'s `repeat` in recipes/datasets.json), falling
// back to `say` when no such key is declared. A recipe that appears once
// on each side is matched by recipe alone, so any bind difference — even
// on that repeat-eligible key — shows up as one `binding_changed`, not a
// remove-and-add. A recipe that repeats is matched per distinct target, so
// two trend panels (`by: region`, `by: category`) stay two panels.
// ---------------------------------------------------------------------------
function repeatKeyFor(recipe) {
  const { datasets } = loadCatalogue()
  for (const group of Object.values(datasets)) {
    for (const dataset of group.datasets ?? []) {
      if (dataset.repeat?.recipe === recipe) return dataset.repeat.bind
    }
  }
  return undefined
}

function panelIdentities(panels) {
  const byRecipe = new Map()
  panels.forEach((panel, index) => byRecipe.set(panel.recipe, [...(byRecipe.get(panel.recipe) ?? []), index]))
  const ids = new Array(panels.length)
  for (const [recipe, indexes] of byRecipe) {
    if (indexes.length === 1) {
      ids[indexes[0]] = recipe
      continue
    }
    const key = repeatKeyFor(recipe)
    for (const index of indexes) {
      const panel = panels[index]
      const target = key === undefined ? panel.say : panel.bind?.[key]
      ids[index] = `${recipe}:${target ?? ''}`
    }
  }
  return ids
}

function recipeNameOf(ra, rb, recipe) {
  return (recipesFor(rb)[recipe] ?? recipesFor(ra)[recipe])?.name ?? recipe
}

function sayChangeText(before, after) {
  if (before === undefined) return `now asks "${after}"`
  if (after === undefined) return `no longer shows a question (was "${before}")`
  return `now asks "${after}" (was "${before}")`
}
const widthWord = (width) => width ?? 'full'
function widthChangeText(before, after) {
  return `now shown at ${widthWord(after)} width (was ${widthWord(before)} width)`
}

/** trend's `by` gets its own sentence: "Orders over time now splits by Channel instead of Region." */
function trendByText(rb, panelA, panelB, before, after) {
  const measuresBind = panelB.bind?.measures ?? panelA.bind?.measures
  const subject = measuresText(rb, measuresBind) ?? 'the trend'
  const subjectCap = subject.charAt(0).toUpperCase() + subject.slice(1)
  const beforeLabel = dimText(rb, before)
  const afterLabel = dimText(rb, after)
  if (before === undefined) return `${subjectCap} over time now splits by ${afterLabel}`
  if (after === undefined) return `${subjectCap} over time no longer splits by ${beforeLabel}`
  return `${subjectCap} over time now splits by ${afterLabel} instead of ${beforeLabel}`
}

function bindingText(ra, rb, recipeDef, recipe, key, before, after, panelA, panelB) {
  if (recipe === 'trend' && key === 'by') return trendByText(rb, panelA, panelB, before, after)
  const type = recipeDef?.bind?.[key]?.type
  const name = recipeDef?.name ?? recipe
  const beforeText = display(valueText(ra, type, before), before)
  const afterText = display(valueText(rb, type, after), after)
  if (before === undefined) return `${name}: ${key} set to ${afterText}`
  if (after === undefined) return `${name}: ${key} no longer set (was ${beforeText})`
  return `${name} ${key.replaceAll('_', ' ')}: ${beforeText} -> ${afterText}`
}

function comparePanel(ra, rb, panelA, panelB, indexB) {
  const changes = []
  const recipeDef = recipesFor(rb)[panelA.recipe] ?? recipesFor(ra)[panelA.recipe]
  const keys = [...new Set([...Object.keys(panelA.bind ?? {}), ...Object.keys(panelB.bind ?? {})])].sort()
  for (const key of keys) {
    const before = panelA.bind?.[key]
    const after = panelB.bind?.[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    changes.push({ kind: 'binding_changed', path: `/panels/${indexB}/bind/${key}`, before, after, text: bindingText(ra, rb, recipeDef, panelA.recipe, key, before, after, panelA, panelB) })
  }
  if (panelA.say !== panelB.say) changes.push({ kind: 'panel_changed', path: `/panels/${indexB}/say`, before: panelA.say, after: panelB.say, text: sayChangeText(panelA.say, panelB.say) })
  if ((panelA.width ?? null) !== (panelB.width ?? null)) changes.push({ kind: 'panel_changed', path: `/panels/${indexB}/width`, before: panelA.width, after: panelB.width, text: widthChangeText(panelA.width, panelB.width) })
  return changes
}

function panelAddedChange(ra, rb, panel, indexB) {
  const name = recipeNameOf(ra, rb, panel.recipe)
  const say = panel.say ? ` - "${panel.say}"` : ''
  return { kind: 'panel_added', path: `/panels/${indexB}`, after: panel, text: `added "${name}"${say}` }
}
function panelRemovedChange(ra, rb, panel, indexA) {
  const name = recipeNameOf(ra, rb, panel.recipe)
  const say = panel.say ? ` - "${panel.say}"` : ''
  return { kind: 'panel_removed', path: `/panels/${indexA}`, before: panel, text: `removed "${name}"${say}` }
}

function diffPanels(ra, rb) {
  const idsA = panelIdentities(ra.panels)
  const idsB = panelIdentities(rb.panels)
  return diffOrderedList(ra.panels, rb.panels, (_item, index) => idsA[index], (_item, index) => idsB[index], {
    matched: (panelA, indexA, panelB, indexB) => comparePanel(ra, rb, panelA, panelB, indexB),
    added: (panelB, indexB) => [panelAddedChange(ra, rb, panelB, indexB)],
    removed: (panelA, indexA) => [panelRemovedChange(ra, rb, panelA, indexA)],
  })
}

// ---------------------------------------------------------------------------
// Measures / dimensions — identity is `id` / `field`.
// ---------------------------------------------------------------------------

function measureFieldChanges(mA, mB, indexB) {
  const label = mB.label
  const changes = []
  if (mA.label !== mB.label) changes.push({ kind: 'measure_changed', path: `/measures/${indexB}/label`, before: mA.label, after: mB.label, text: `"${mA.label}" is now called "${mB.label}"` })
  if (mA.column !== mB.column) changes.push({ kind: 'measure_changed', path: `/measures/${indexB}/column`, before: mA.column, after: mB.column, text: `${label} now reads column \`${mB.column}\` (was \`${mA.column}\`)` })
  if (mA.format !== mB.format) changes.push({ kind: 'measure_changed', path: `/measures/${indexB}/format`, before: mA.format, after: mB.format, text: `${label} now shown as ${formatWord(mB.format)} (was ${formatWord(mA.format)})` })
  if (mA.good !== mB.good) changes.push({ kind: 'measure_changed', path: `/measures/${indexB}/good`, before: mA.good, after: mB.good, text: `${label} is now good when it goes ${mB.good} (was ${mA.good})` })
  if (mA.role !== mB.role) changes.push({ kind: 'measure_changed', path: `/measures/${indexB}/role`, before: mA.role, after: mB.role, text: mB.role === 'primary' ? `${label} is now the primary measure` : `${label} is no longer the primary measure` })
  return changes
}

function diffMeasures(ra, rb) {
  return diffOrderedList(ra.measures, rb.measures, (m) => m.id, (m) => m.id, {
    matched: (mA, indexA, mB, indexB) => measureFieldChanges(mA, mB, indexB),
    added: (mB, indexB) => [{ kind: 'measure_added', path: `/measures/${indexB}`, after: mB, text: `added measure "${mB.label}"` }],
    removed: (mA, indexA) => [{ kind: 'measure_removed', path: `/measures/${indexA}`, before: mA, text: `removed measure "${mA.label}"` }],
  })
}

function diffDimensions(ra, rb) {
  return diffOrderedList(ra.dimensions, rb.dimensions, (d) => d.field, (d) => d.field, {
    matched: (dA, indexA, dB, indexB) =>
      dA.label === dB.label ? [] : [{ kind: 'dimension_changed', path: `/dimensions/${indexB}/label`, before: dA.label, after: dB.label, text: `"${dA.label}" is now called "${dB.label}"` }],
    added: (dB, indexB) => [{ kind: 'dimension_added', path: `/dimensions/${indexB}`, after: dB, text: `${dB.label} is now available to cut by` }],
    removed: (dA, indexA) => [{ kind: 'dimension_removed', path: `/dimensions/${indexA}`, before: dA, text: `${dA.label} is no longer available to cut by` }],
  })
}

// ---------------------------------------------------------------------------
// Controls — identity is the kind, plus the narrowed dimension for `filter`
// (several filters may coexist, one per dimension).
// ---------------------------------------------------------------------------

function controlIdentity(control) {
  return control.kind === 'filter' ? `filter:${control.dim}` : control.kind
}
function controlLabel(spec, control) {
  switch (control.kind) {
    case 'filter': return `narrow by ${dimLabelOf(spec, control.dim)}`
    case 'time': return control.presets === undefined ? 'choose a time range' : `choose a time range: ${control.presets.join(', ')}`
    case 'measure': return control.options === undefined ? 'switch which measure is shown' : `switch between ${control.options.map((id) => wordOf(spec, id)).join(', ')}`
    case 'dimensions': return 'choose which dimensions to cut by'
    case 'heatmap_axes': return 'change the heatmap axes'
    case 'variant': return 'switch the highlighted variant'
    case 'depth': return 'change how many cuts deep to look'
    case 'entity': return `switch the ${spec.entity?.label ?? 'entity'}`
    default: return `use the ${control.kind} control`
  }
}
const fmtControlValue = (value) => (value === undefined ? 'none' : Array.isArray(value) ? value.join(', ') : String(value))

function controlFieldChanges(ra, rb, cA, cB, indexB) {
  const changes = []
  const keys = [...new Set([...Object.keys(cA), ...Object.keys(cB)])].filter((key) => key !== 'kind' && key !== 'dim').sort()
  const label = controlLabel(rb, cB)
  for (const key of keys) {
    const before = cA[key]
    const after = cB[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    changes.push({ kind: 'control_changed', path: `/controls/${indexB}/${key}`, before, after, text: `${label}: ${key} ${fmtControlValue(before)} -> ${fmtControlValue(after)}` })
  }
  return changes
}

function diffControls(ra, rb) {
  return diffOrderedList(ra.controls ?? [], rb.controls ?? [], controlIdentity, controlIdentity, {
    matched: (cA, indexA, cB, indexB) => controlFieldChanges(ra, rb, cA, cB, indexB),
    added: (cB, indexB) => [{ kind: 'control_added', path: `/controls/${indexB}`, after: cB, text: `viewers can now ${controlLabel(rb, cB)}` }],
    removed: (cA, indexA) => [{ kind: 'control_removed', path: `/controls/${indexA}`, before: cA, text: `viewers can no longer ${controlLabel(ra, cA)}` }],
  })
}

// ---------------------------------------------------------------------------
// Rules — a fixed field set, plus the free-form `targets` map.
// ---------------------------------------------------------------------------

function diffRules(ra, rb) {
  const a = ra.rules ?? {}
  const b = rb.rules ?? {}
  const changes = []
  const field = (key, text) => {
    if (a[key] === b[key]) return
    changes.push({ kind: 'rule_changed', path: `/rules/${key}`, before: a[key], after: b[key], text: text(a[key], b[key]) })
  }
  field('confidence_bar', (x, y) => `confidence bar ${x} -> ${y}`)
  field('min_bookers', (x, y) => `minimum bookers to include a segment: ${x} -> ${y}`)
  field('trim_quartile', (_x, y) => (y ? 'now trims the thinnest quartile by bookers' : 'no longer trims the thinnest quartile by bookers'))
  field('compare_periods', (x, y) => `compares the last ${y} periods against the ${y} before (was ${x})`)
  field('targets_blob', (x, y) => (y === undefined ? `targets no longer come from a blob (was "${x}")` : x === undefined ? `targets now come from the "${y}" blob` : `targets now come from the "${y}" blob (was "${x}")`))
  const targetsA = a.targets ?? {}
  const targetsB = b.targets ?? {}
  for (const key of [...new Set([...Object.keys(targetsA), ...Object.keys(targetsB)])].sort()) {
    if (targetsA[key] === targetsB[key]) continue
    const label = wordOf(rb, key)
    const before = targetsA[key]
    const after = targetsB[key]
    const text = after === undefined ? `no longer targets ${label} (was ${before})` : before === undefined ? `now targets ${label} at ${after}` : `target for ${label}: ${before} -> ${after}`
    changes.push({ kind: 'rule_changed', path: `/rules/targets/${key}`, before, after, text })
  }
  return changes
}

// ---------------------------------------------------------------------------
// Words — display names keyed by measure/metric id.
// ---------------------------------------------------------------------------

function diffWords(ra, rb) {
  const a = ra.words ?? {}
  const b = rb.words ?? {}
  const changes = []
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const before = a[key]
    const after = b[key]
    if (before === after) continue
    const text = before === undefined ? `"${key}" is now labeled "${after}"` : after === undefined ? `"${key}" no longer has a label (was "${before}")` : `"${before}" is now called "${after}"`
    changes.push({ kind: 'words_changed', path: `/words/${key}`, before, after, text })
  }
  return changes
}

// ---------------------------------------------------------------------------
// Time / theme / chat / store — fixed-shape objects, one Change per field.
// ---------------------------------------------------------------------------

function diffTime(ra, rb) {
  const a = ra.time
  const b = rb.time
  const changes = []
  if (a.column !== b.column) changes.push({ kind: 'time_changed', path: '/time/column', before: a.column, after: b.column, text: `now reads time from \`${b.column}\` (was \`${a.column}\`)` })
  if (a.from !== b.from) changes.push({ kind: 'time_changed', path: '/time/from', before: a.from, after: b.from, text: `start date: ${a.from} -> ${b.from}` })
  if (a.to !== b.to) changes.push({ kind: 'time_changed', path: '/time/to', before: a.to, after: b.to, text: `end date: ${a.to} -> ${b.to}` })
  if (a.grain !== b.grain) changes.push({ kind: 'time_changed', path: '/time/grain', before: a.grain, after: b.grain, text: `now ${grainWord(b.grain)} instead of ${grainWord(a.grain)}` })
  return changes
}

function diffTheme(ra, rb) {
  const a = ra.theme
  const b = rb.theme
  const changes = []
  if (a.accent !== b.accent) changes.push({ kind: 'theme_changed', path: '/theme/accent', before: a.accent, after: b.accent, text: `accent color: ${a.accent} -> ${b.accent}` })
  if (a.follow !== b.follow) changes.push({ kind: 'theme_changed', path: '/theme/follow', before: a.follow, after: b.follow, text: `theme now follows ${b.follow} (was ${a.follow})` })
  return changes
}

function diffChat(ra, rb) {
  const a = ra.chat
  const b = rb.chat
  if (a === undefined && b === undefined) return []
  if (a === undefined) return [{ kind: 'chat_changed', path: '/chat/enabled', after: b.enabled, text: b.enabled ? `chat is now available to viewers, anchored to ${b.anchors.join(', ')}` : 'chat is now configured, but disabled' }]
  if (b === undefined) return [{ kind: 'chat_changed', path: '/chat/enabled', before: a.enabled, text: 'chat is no longer available' }]
  const changes = []
  if (a.enabled !== b.enabled) changes.push({ kind: 'chat_changed', path: '/chat/enabled', before: a.enabled, after: b.enabled, text: b.enabled ? 'chat is now enabled for viewers' : 'chat is now disabled for viewers' })
  if (JSON.stringify(a.anchors) !== JSON.stringify(b.anchors)) changes.push({ kind: 'chat_changed', path: '/chat/anchors', before: a.anchors, after: b.anchors, text: `chat can now anchor to: ${b.anchors.join(', ')} (was ${a.anchors.join(', ')})` })
  return changes
}

function humanDuration(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds / 86400 === 1 ? '' : 's'}`
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds / 3600 === 1 ? '' : 's'}`
  return `${seconds}s`
}

function diffStoreCache(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (a === undefined) return [{ kind: 'store_changed', path: '/store/cache', after: b, text: `the app can now cache ${b.writable_by === 'builder' ? 'builder-only' : 'viewer-writable'} state for ${humanDuration(b.ttl_seconds ?? 86400)}` }]
  if (b === undefined) return [{ kind: 'store_changed', path: '/store/cache', before: a, text: 'the app no longer caches state' }]
  const changes = []
  if ((a.ttl_seconds ?? 86400) !== (b.ttl_seconds ?? 86400)) changes.push({ kind: 'store_changed', path: '/store/cache/ttl_seconds', before: a.ttl_seconds, after: b.ttl_seconds, text: `cached state now expires after ${humanDuration(b.ttl_seconds ?? 86400)} (was ${humanDuration(a.ttl_seconds ?? 86400)})` })
  if ((a.writable_by ?? 'viewer') !== (b.writable_by ?? 'viewer')) changes.push({ kind: 'store_changed', path: '/store/cache/writable_by', before: a.writable_by, after: b.writable_by, text: `cached state is now writable by ${b.writable_by ?? 'viewer'} (was ${a.writable_by ?? 'viewer'})` })
  return changes
}

function diffStoreBlobs(blobsA, blobsB) {
  const a = new Map((blobsA ?? []).map((blob) => [blob.name, blob]))
  const b = new Map((blobsB ?? []).map((blob) => [blob.name, blob]))
  const changes = []
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const blobA = a.get(name)
    const blobB = b.get(name)
    if (JSON.stringify(blobA) === JSON.stringify(blobB)) continue
    if (blobA === undefined) { changes.push({ kind: 'store_changed', path: `/store/blobs/${name}`, after: blobB, text: `the app can now read the "${name}" blob: ${blobB.purpose}` }); continue }
    if (blobB === undefined) { changes.push({ kind: 'store_changed', path: `/store/blobs/${name}`, before: blobA, text: `the app no longer reads the "${name}" blob` }); continue }
    if (blobA.purpose !== blobB.purpose) changes.push({ kind: 'store_changed', path: `/store/blobs/${name}/purpose`, before: blobA.purpose, after: blobB.purpose, text: `the "${name}" blob's purpose changed: "${blobA.purpose}" -> "${blobB.purpose}"` })
    if ((blobA.kind ?? 'json') !== (blobB.kind ?? 'json')) changes.push({ kind: 'store_changed', path: `/store/blobs/${name}/kind`, before: blobA.kind, after: blobB.kind, text: `the "${name}" blob is now ${blobB.kind ?? 'json'} (was ${blobA.kind ?? 'json'})` })
    if (blobA.max_bytes !== blobB.max_bytes) changes.push({ kind: 'store_changed', path: `/store/blobs/${name}/max_bytes`, before: blobA.max_bytes, after: blobB.max_bytes, text: `the "${name}" blob's size limit changed: ${blobA.max_bytes ?? 'default'} -> ${blobB.max_bytes ?? 'default'}` })
  }
  return changes
}

function diffStore(ra, rb) {
  return [...diffStoreCache(ra.store?.cache, rb.store?.cache), ...diffStoreBlobs(ra.store?.blobs, rb.store?.blobs)]
}

// ---------------------------------------------------------------------------
// Entity / family — nested objects with no fixed depth. Walked field by
// field (recursing through plain-object values) so a change anywhere in
// them still reads in words, never as a JSON blob.
// ---------------------------------------------------------------------------
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function leafDiffs(before, after, path = []) {
  if (isPlainObject(before) || isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()
    return keys.flatMap((key) => leafDiffs(before?.[key], after?.[key], [...path, key]))
  }
  const same = Array.isArray(before) || Array.isArray(after) ? JSON.stringify(before) === JSON.stringify(after) : before === after
  return same ? [] : [{ path, before, after }]
}
function nestedText(humanPath, before, after) {
  const fmt = (value) => (value === undefined ? 'none' : Array.isArray(value) ? value.join(', ') : String(value))
  if (before === undefined) return `${humanPath} added: ${fmt(after)}`
  if (after === undefined) return `${humanPath} removed (was ${fmt(before)})`
  return `${humanPath}: ${fmt(before)} -> ${fmt(after)}`
}
function diffNestedObject(kind, sectionPath, prefix, before, after) {
  if (before === undefined && after === undefined) return []
  return leafDiffs(before ?? {}, after ?? {}).map((leaf) => ({
    kind,
    path: `${sectionPath}/${leaf.path.join('/')}`,
    before: leaf.before,
    after: leaf.after,
    text: nestedText([prefix, ...leaf.path].join(' ').replaceAll('_', ' '), leaf.before, leaf.after),
  }))
}

// ---------------------------------------------------------------------------
// Everything else: one Change per top-level field.
// ---------------------------------------------------------------------------

function diffRest(ra, rb) {
  const changes = []
  if (ra.title !== rb.title) changes.push({ kind: 'title_changed', path: '/title', before: ra.title, after: rb.title, text: `title: "${ra.title}" -> "${rb.title}"` })
  if (ra.decision !== rb.decision) {
    const text = ra.decision === undefined ? `decision: "${rb.decision}"` : rb.decision === undefined ? `no longer states a decision (was "${ra.decision}")` : `decision: "${ra.decision}" -> "${rb.decision}"`
    changes.push({ kind: 'decision_changed', path: '/decision', before: ra.decision, after: rb.decision, text })
  }
  if (ra.persona !== rb.persona) changes.push({ kind: 'persona_changed', path: '/persona', before: ra.persona, after: rb.persona, text: `now built for ${personaWord(rb.persona)} (was ${personaWord(ra.persona)})` })
  if (ra.template !== rb.template) changes.push({ kind: 'template_changed', path: '/template', before: ra.template, after: rb.template, text: `now uses the "${rb.template}" template (was "${ra.template}")` })
  changes.push(...diffTime(ra, rb))
  changes.push(...diffNestedObject('entity_changed', '/entity', 'entity', ra.entity, rb.entity))
  changes.push(...diffNestedObject('family_changed', '/family', 'family', ra.family, rb.family))
  changes.push(...diffTheme(ra, rb))
  changes.push(...diffStore(ra, rb))
  changes.push(...diffChat(ra, rb))
  return changes
}

// ---------------------------------------------------------------------------

/**
 * @returns {{ changes: Array<{kind: string, path: string, before?: *, after?: *, text: string}> }}
 *
 * Order: panels (in panel order), then measures, dimensions, controls,
 * rules, words, then everything else (title, decision, persona, template,
 * time, entity, family, theme, store, chat). Deterministic: object-keyed
 * sections (words, rule targets, store blobs, control/binding fields) sort
 * their keys.
 *
 * `appId`, `model` and `version` are never diffed — they are the app's
 * deployment identity, not its content; changing them is not a version of
 * the same app.
 */
export function diffSpecs(a, b) {
  const ra = normalize(resolveSpec(a))
  const rb = normalize(resolveSpec(b))
  return {
    changes: [
      ...diffPanels(ra, rb),
      ...diffMeasures(ra, rb),
      ...diffDimensions(ra, rb),
      ...diffControls(ra, rb),
      ...diffRules(ra, rb),
      ...diffWords(ra, rb),
      ...diffRest(ra, rb),
    ],
  }
}
