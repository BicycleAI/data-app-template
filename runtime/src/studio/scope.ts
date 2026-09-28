/**
 * The page's scope: everything this page is set to, fully resolved, for the
 * host's chat.
 *
 * Carried on every `studio:sandbox:context` message (`contextRegistry.ts`'s
 * `setPageScope`). The host forwards it with every chat question and the
 * agent applies it to every query it runs, so it is always reported whole
 * (`complete: true`), defaults included. That is the difference from
 * `studio:sandbox:state`, which carries only what differs from the defaults
 * so the host can keep its URL bare: `state` is the deep-link contract,
 * `scope` is what the page is showing.
 *
 * Pure. `ControlsProvider` (controls.tsx) builds it from its own state, the
 * `UiProvider` state (the rail's measure and checked dimensions) and the
 * picked entity, on every change.
 */

import { type ControlDefaults, type ControlsState, isoDay, sameValues, sameWindow } from '../controls.js'
import { type FilterControl, filterControls, isAb, measureById, type Spec } from '../spec.js'
import type { UiState } from '../ui.js'

export type ScopeWindow = {
  /** The column every query bounds: `spec.time.column`, or the composer's `timestamp` default. */
  readonly column?: string
  /** Inclusive, `YYYY-MM-DD`. */
  readonly from: string
  /** EXCLUSIVE, `YYYY-MM-DD`: the kit's own SQL is `time >= :from AND time < :to`. */
  readonly to: string
  /** The `time` control's preset, when one is selected (`7d`, `30d`, `90d`, `quarter`, `ytd`). */
  readonly preset?: string
  readonly grain?: string
  /** The app's default window: the default preset, or the spec's own range when it declares none. */
  readonly isDefault: boolean
}

/** A filter that narrows. One at "All" (every option picked) is not reported. */
export type ScopeFilter = {
  readonly field: string
  readonly label?: string
  readonly values: readonly string[]
  /** Equal to the control's own seed, compared as a set — exactly when `studio:sandbox:state` leaves it out. */
  readonly isDefault: boolean
}

export type ScopeMeasure = { readonly id: string; readonly column?: string; readonly label?: string }
export type ScopeDimension = { readonly field: string; readonly label?: string }
export type ScopeEntity = { readonly field: string; readonly value: string; readonly label?: string }
/** "Last `periods` vs the `periods` before", in `grain`s: what `kpis`, `verdict` and `narrative` compare. */
export type ScopeCompare = { readonly periods: number; readonly grain?: string }

/** The wire shape. Other repos read the same one; change it only with them. */
export type PageScope = {
  readonly complete: true
  readonly model?: string
  readonly window?: ScopeWindow
  readonly asOf?: string
  /** Only the filters that narrow; `[]` when none does. */
  readonly filters: readonly ScopeFilter[]
  readonly measure?: ScopeMeasure
  /** The checked split-by dimensions, in spec order. */
  readonly dimensions?: readonly ScopeDimension[]
  /** Only once one is picked. */
  readonly entity?: ScopeEntity
  /** Omitted for an `ab_test` spec, which compares arms, not periods. */
  readonly compare?: ScopeCompare
  /** Never set by this kit: its spec has no tabs. */
  readonly tab?: string
}

/** What the host accepts. A schema-valid spec stays well inside all of them except a filter offering more than 100 values. */
export const SCOPE_LIMITS = { filters: 24, values: 100, dimensions: 24, chars: 256 } as const

/** Mirrors `compose/datasets.mjs`'s `TIME_DEFAULT` (and the schema's default): the column the composed SQL bounds when the spec names none. */
const TIME_COLUMN_DEFAULT = 'timestamp'

export type PageScopeInput = {
  readonly spec: Spec
  /** `ControlsProvider`'s state. `time` is always concrete: a preset is already resolved to its dates. */
  readonly controls: Pick<ControlsState, 'filters' | 'time' | 'asOf'>
  /** What "untouched" means: `applyRenderState`'s `defaults`. */
  readonly defaults: ControlDefaults
  /** `UiProvider`'s state: the measure the rail has selected and the checked dimensions. */
  readonly ui: Pick<UiState, 'measure' | 'dims'>
  /** The entity the viewer picked, when the spec has one. */
  readonly entityId: string | undefined
}

const clip = (text: string): string => (text.length <= SCOPE_LIMITS.chars ? text : text.slice(0, SCOPE_LIMITS.chars))

/**
 * Whether a filter's picks narrow anything. No pick at all binds no clause
 * (the composer renders none for a filter with nothing to seed it). Every
 * declared option picked is the "All" chip, `resetFilter`'s state. A filter
 * that declares no options has no "All" to be at: its slots are bound to
 * whatever it holds, so any pick narrows.
 */
function narrows(filterControl: FilterControl, values: readonly string[]): boolean {
  if (values.length === 0) return false
  const options = (filterControl.options ?? []).map((option) => String(option))
  return options.length === 0 || !options.every((option) => values.includes(option))
}

function filtersOf(spec: Spec, filters: PageScopeInput['controls']['filters'], defaults: ControlDefaults['filters']): ScopeFilter[] {
  const out: ScopeFilter[] = []
  for (const filterControl of filterControls(spec)) {
    if (out.length === SCOPE_LIMITS.filters) break
    const dim = filterControl.dim
    const seed = defaults[dim] ?? []
    const picked = filters[dim] ?? seed
    const values = [...new Set(picked)]
    if (!narrows(filterControl, values)) continue
    const label = spec.dimensions.find((dimension) => dimension.field === dim)?.label
    out.push({
      field: clip(dim),
      ...(label === undefined ? {} : { label: clip(label) }),
      values: values.slice(0, SCOPE_LIMITS.values).map(clip),
      isDefault: sameValues(picked, seed),
    })
  }
  return out
}

function windowOf(spec: Spec, time: PageScopeInput['controls']['time'], defaults: ControlDefaults['time']): ScopeWindow | undefined {
  const from = isoDay(time.from)
  const to = isoDay(time.to)
  if (from === undefined || to === undefined) return undefined
  return {
    column: clip(spec.time.column ?? TIME_COLUMN_DEFAULT),
    from,
    to,
    ...(time.preset === undefined ? {} : { preset: time.preset }),
    grain: spec.time.grain ?? 'day',
    isDefault: sameWindow(time, defaults),
  }
}

/** An `ab_test` metric (`NIBPD`…) is derived, with no `spec.measures` entry to name a column or label. */
function measureOf(spec: Spec, id: string): ScopeMeasure | undefined {
  if (id === '') return undefined
  const measure = isAb(spec) ? undefined : measureById(spec, id)
  return measure === undefined ? { id: clip(id) } : { id: clip(measure.id), column: clip(measure.column), label: clip(measure.label) }
}

/** Everything the page is set to, as the host's chat applies it. See the module comment. */
export function pageScope({ spec, controls, defaults, ui, entityId }: PageScopeInput): PageScope {
  const timeWindow = windowOf(spec, controls.time, defaults.time)
  const asOf = isoDay(controls.asOf)
  const measure = measureOf(spec, ui.measure)
  const dimensions =
    spec.dimensions.length === 0
      ? undefined
      : spec.dimensions
          .filter((dimension) => ui.dims.includes(dimension.field))
          .slice(0, SCOPE_LIMITS.dimensions)
          .map((dimension) => ({ field: clip(dimension.field), label: clip(dimension.label) }))
  const entity = spec.entity === undefined || entityId === undefined || entityId === '' ? undefined : { field: clip(spec.entity.field), value: clip(entityId), label: clip(spec.entity.label) }
  return {
    complete: true,
    model: clip(spec.model),
    ...(timeWindow === undefined ? {} : { window: timeWindow }),
    ...(asOf === undefined ? {} : { asOf }),
    filters: filtersOf(spec, controls.filters, defaults.filters),
    ...(measure === undefined ? {} : { measure }),
    ...(dimensions === undefined ? {} : { dimensions }),
    ...(entity === undefined ? {} : { entity }),
    ...(isAb(spec) ? {} : { compare: { periods: spec.rules?.compare_periods ?? 7, grain: spec.time.grain ?? 'day' } }),
  }
}
