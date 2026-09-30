/**
 * The page's outline: what this page is, for the host's chat. Its controls,
 * in screen order, with what each one offers (the presets, the options, what
 * it starts on), and its panels.
 *
 * Structure only: what each control is set to right now is the scope's
 * (`scope.ts`), so the outline rarely changes. It rides on every
 * `studio:sandbox:context` message (`contextRegistry.ts`'s `setPageOutline`),
 * and the host sends it when a chat thread starts and again only when it
 * changes. That is what lets the agent answer a question about the page
 * itself ("how many date ranges can I pick?") plainly, without a query.
 *
 * Pure, and built from the helpers the chrome renders with (`measureOptions`,
 * `depthOptions`, `initialUi`, `seedOf`/`slotsOf`, `timePresets`/
 * `PRESET_LABEL`, `panelsOf`/`panelId`), so it says what the screen shows.
 * `App` reports it whenever the spec or the loaded entity list changes.
 * agent-service ports the same mapping (`outline_from_spec`, without the
 * entity list) for a bundle that reports none: `evals/outline.test.tsx` pins
 * the fixture both are tested against.
 */

import { PRESET_LABEL, seedOf, slotsOf, timePresets } from '../controls.js'
import type { EntityOption } from '../data.js'
import { control, controlEnabled, dimensionLabel, filterControls, panelId, panelsOf, type Spec, word } from '../spec.js'
import { depthOptions, initialUi, measureOptions } from '../ui.js'

/** One choice a control offers. `label` when the page shows something other than the value. */
export type OutlineOption = { readonly value: string; readonly label?: string }

export type OutlineControl = {
  /** Stable within the page: `entity`, `measure`, `filter.<dim>`, `time`. */
  readonly id: string
  /** `dateRange`, `filter`, `measure`, `dimensions`, `entity`, `select` or `toggle`. Free text on the wire. */
  readonly kind: string
  /** As the page shows it: `Time`, `Region`. */
  readonly label: string
  /** In the page's order. A `dateRange`'s options are its presets. */
  readonly options?: readonly OutlineOption[]
  /** How many options there are in all, when `options` lists fewer (or none). */
  readonly optionCount?: number
  /** Present (true) only when more than one option may be picked. */
  readonly multi?: boolean
  /** Only with `multi`: at most this many. */
  readonly maxPicks?: number
  /** The option values the page starts on. `[]` is nothing picked, which narrows nothing. */
  readonly default?: readonly string[]
  /** `YYYY-MM-DD`, inclusive: a `dateRange` that also takes any custom from/to between these. Never set by this kit: it offers presets only. */
  readonly range?: { readonly min: string; readonly max: string }
  /** The control sits inside this one panel and changes only it. */
  readonly panelId?: string
}

export type OutlinePanel = {
  /** The id the context registry reports the same panel under (`p3:ranking`). */
  readonly panelId: string
  readonly title: string
  readonly kind?: string
  /** The recipe's method sentence: the provenance popover's "Method". */
  readonly explain?: string
  /** Never set by this kit: its spec has no tabs. */
  readonly tab?: string
}

export type OutlineTab = { readonly label: string; readonly active: boolean }

/** The wire shape. Other repos read the same one; change it only with them. */
export type PageOutline = {
  readonly title?: string
  /** What the page is for: `spec.decision`. */
  readonly description?: string
  /** In screen order; `[]` for a page with none. */
  readonly controls: readonly OutlineControl[]
  /** Every panel the page has, on screen or not, in page order. */
  readonly panels?: readonly OutlinePanel[]
  /** Never set by this kit: its spec has no tabs. */
  readonly tabs?: readonly OutlineTab[]
  /** Page text a viewer reads that no control or panel carries. Never set by this kit. */
  readonly notes?: readonly string[]
}

/**
 * What the host accepts; every repo uses these numbers. `chars` is short text
 * (an id, label, value, title or tab), `longChars` a description, an explain
 * or a note. The host also trims the whole outline to a 16 KB budget, so a
 * frame never has to.
 */
export const OUTLINE_LIMITS = {
  controls: 24,
  options: 100,
  defaults: 100,
  panels: 48,
  tabs: 12,
  notes: 8,
  chars: 256,
  kindChars: 64,
  panelIdChars: 128,
  longChars: 1000,
  optionCount: 1_000_000,
  maxPicks: 1000,
} as const

export type PageOutlineInput = {
  readonly spec: Spec
  /** The entity list (`data.ts`'s `useEntityList`), once it has loaded. Until then the entity control lists no options. */
  readonly entities?: readonly Pick<EntityOption, 'id' | 'label'>[]
}

/** What `UiProvider` starts on: each control's `default`. */
type Initial = ReturnType<typeof initialUi>

const clip = (text: string, max: number = OUTLINE_LIMITS.chars): string => (text.length <= max ? text : text.slice(0, max))

const option = (value: string, label?: string): OutlineOption => ({ value: clip(value), ...(label === undefined ? {} : { label: clip(label) }) })

const defaults = (values: readonly string[]): string[] => values.slice(0, OUTLINE_LIMITS.defaults).map((value) => clip(value))

/** A list within the cap. A longer one keeps its first 100, and `optionCount` says how many there are in all. */
function listed(options: readonly OutlineOption[]): Pick<OutlineControl, 'options' | 'optionCount'> {
  if (options.length <= OUTLINE_LIMITS.options) return { options }
  return { options: options.slice(0, OUTLINE_LIMITS.options), optionCount: Math.min(options.length, OUTLINE_LIMITS.optionCount) }
}

const dimensionOptions = (spec: Spec): OutlineOption[] => spec.dimensions.map((dimension) => option(dimension.field, dimension.label))

/** The picker the chrome draws when the spec has an entity and declares its control. Its options are the viewer's: they exist once the list has loaded. */
function entityControl(spec: Spec, entities: PageOutlineInput['entities']): OutlineControl | undefined {
  if (spec.entity === undefined || !controlEnabled(spec, 'entity')) return undefined
  const picker = { id: 'entity', kind: 'entity', label: clip(spec.entity.label) }
  if (entities === undefined) return picker
  return {
    ...picker,
    options: entities.slice(0, OUTLINE_LIMITS.options).map((entity) => option(entity.id, entity.label)),
    optionCount: Math.min(entities.length, OUTLINE_LIMITS.optionCount),
  }
}

/** `MeasureSelect`/`MetricChips`: drawn only with two options or more. */
function measureControl(spec: Spec, initial: Initial): OutlineControl | undefined {
  const ids = measureOptions(spec).map((id) => String(id))
  if (!controlEnabled(spec, 'measure') || ids.length < 2) return undefined
  return { id: 'measure', kind: 'measure', label: 'Measure', ...listed(ids.map((id) => option(id, word(spec, id)))), default: defaults([String(initial.measure)]) }
}

/** `DepthPills`. */
function depthControl(spec: Spec, initial: Initial): OutlineControl | undefined {
  if (!controlEnabled(spec, 'depth')) return undefined
  return { id: 'depth', kind: 'select', label: 'Combine', ...listed(depthOptions(spec).map((depth) => option(String(depth), `${depth}-way`))), default: [String(initial.depth)] }
}

/** `DimensionChecks`: any of them, every one checked to start. */
function dimensionsControl(spec: Spec, initial: Initial): OutlineControl | undefined {
  if (!controlEnabled(spec, 'dimensions') || spec.dimensions.length === 0) return undefined
  return { id: 'dimensions', kind: 'dimensions', label: 'Dimensions', ...listed(dimensionOptions(spec)), multi: true, default: defaults(initial.dims) }
}

/**
 * The FilterBar's groups, in spec order. A filter starts on its seed, which
 * is what its query binds before anyone picks, and a multi filter takes at
 * most its slots. One that declares no options lists none.
 */
function filterOutline(spec: Spec): OutlineControl[] {
  return filterControls(spec).map((filterControl) => {
    const seed = seedOf(filterControl)
    const options = (filterControl.options ?? []).map((value) => option(String(value)))
    return {
      id: clip(`filter.${filterControl.dim}`),
      kind: 'filter',
      label: clip(dimensionLabel(spec, filterControl.dim)),
      ...(options.length === 0 ? {} : listed(options)),
      ...(filterControl.multi === true ? { multi: true, maxPicks: slotsOf(filterControl, seed) } : {}),
      default: defaults(seed),
    }
  })
}

/** The FilterBar's presets. No `range`: there is no custom from/to to pick. */
function timeControl(spec: Spec): OutlineControl | undefined {
  if (!controlEnabled(spec, 'time')) return undefined
  const preset = control(spec, 'time')?.default
  return {
    id: 'time',
    kind: 'dateRange',
    label: 'Time',
    ...listed(timePresets(spec).map((value) => option(value, PRESET_LABEL[value]))),
    ...(preset === undefined ? {} : { default: [clip(String(preset))] }),
  }
}

/**
 * `HeatmapAxes`, in the heatmap card's own header, so it names that panel.
 * The axes are shared UI state: a second heatmap card follows them too, but
 * the outline names the first.
 */
function heatmapAxes(spec: Spec, initial: Initial): OutlineControl[] {
  if (!controlEnabled(spec, 'heatmap_axes') || spec.dimensions.length < 2) return []
  const index = panelsOf(spec).findIndex((panel) => panel.recipe === 'heatmap')
  if (index === -1) return []
  const inPanel = clip(panelId(index, 'heatmap'), OUTLINE_LIMITS.panelIdChars)
  const options = listed(dimensionOptions(spec))
  return [
    { id: 'heatmap.rows', kind: 'select', label: 'Rows', ...options, default: defaults([initial.heatRows]), panelId: inPanel },
    { id: 'heatmap.cols', kind: 'select', label: 'Columns', ...options, default: defaults([initial.heatCols]), panelId: inPanel },
  ]
}

/** Every panel the page renders, under the ids its cards report (`App.tsx`). */
function panelOutline(spec: Spec): OutlinePanel[] {
  return panelsOf(spec)
    .slice(0, OUTLINE_LIMITS.panels)
    .map((panel, index) => ({
      panelId: clip(panelId(index, panel.recipe), OUTLINE_LIMITS.panelIdChars),
      title: clip(panel.say ?? panel.recipe),
      kind: clip(panel.recipe, OUTLINE_LIMITS.kindChars),
      ...(panel.explain === undefined ? {} : { explain: clip(panel.explain, OUTLINE_LIMITS.longChars) }),
    }))
}

/**
 * What the page is, as the host's chat describes it. The controls come in
 * the order both chromes draw them: the entity picker, the measure, the
 * depth, the dimensions, the filters, the time presets, then the ones inside
 * a panel. See the module comment.
 */
export function pageOutline({ spec, entities }: PageOutlineInput): PageOutline {
  const initial = initialUi(spec)
  const controls = [
    entityControl(spec, entities),
    measureControl(spec, initial),
    depthControl(spec, initial),
    dimensionsControl(spec, initial),
    ...filterOutline(spec),
    timeControl(spec),
    ...heatmapAxes(spec, initial),
  ].filter((item): item is OutlineControl => item !== undefined)
  return {
    title: clip(spec.title),
    ...(spec.decision === undefined ? {} : { description: clip(spec.decision, OUTLINE_LIMITS.longChars) }),
    controls: controls.slice(0, OUTLINE_LIMITS.controls),
    panels: panelOutline(spec),
  }
}
