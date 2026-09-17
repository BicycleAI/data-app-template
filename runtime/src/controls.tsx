/**
 * Filter + time control state (T3.3), plus the pure functions that turn it
 * into query parameters and client-side row filters.
 *
 * A `filter` control narrows one declared dimension; the composer gives the
 * datasets that aggregate that dimension away (`totals`, `by_time`,
 * `arm_totals`, `daily_trend`) a fixed-arity `<slug>_0..<slug>_{slots-1}`
 * parameter — see `compose/datasets.mjs`'s `## Filters` for the full
 * contract. The runtime never sees the composed manifest (only
 * `window.__DATA_APP_SPEC`), so `slug`/`slotsOf` below are ported verbatim
 * from the composer: a spec's queries and its FilterBar must agree on both
 * without either side reading the other's output.
 *
 * `by_dimension`, `by_time_<dim>` and `segments` are not filtered by the
 * query (they select the dimension away, not out) — `filterRows` narrows
 * those in memory instead.
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'
import type { Scalar } from './studio/types.js'
import { control, filterControls, type FilterControl, type Spec, type TimePreset } from './spec.js'

/** One filter control's current picks, keyed by the dimension it narrows. */
export type FiltersState = Readonly<Record<string, readonly string[]>>

export type TimeRange = { readonly from: string; readonly to: string }
export type TimeState = TimeRange & { readonly preset?: TimePreset }

/** Mirrors `compose/datasets.mjs`'s `slug` — the two must agree on parameter names. */
export function slug(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

const MAX_SLOTS = 5

function toStrings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item))
}

/** The values a filter starts from: its `default`, or all of its `options` when it has none. */
export function seedOf(filterControl: FilterControl): string[] {
  if (filterControl.default !== undefined) return toStrings(filterControl.default)
  return (filterControl.options ?? []).map((value) => String(value))
}

/**
 * Mirrors `compose/datasets.mjs`'s `slotsOf` exactly: a single-select filter
 * is always 1 slot; a multi filter is `options.length` capped at
 * `MAX_SLOTS`, or `slots` when the control overrides it. `seed` is the
 * fallback when the control has no `options` yet.
 */
export function slotsOf(filterControl: FilterControl, seed: readonly string[]): number {
  if (filterControl.multi !== true) return 1
  const fromOptions = Math.min((filterControl.options ?? []).length, MAX_SLOTS)
  const fallback = fromOptions === 0 ? Math.min(seed.length, MAX_SLOTS) : fromOptions
  return Math.min(MAX_SLOTS, Math.max(1, filterControl.slots ?? fallback))
}

/** Every filter's initial selection — the control default, or all of its options. */
export function initialFilters(spec: Spec): FiltersState {
  const state: Record<string, readonly string[]> = {}
  for (const filterControl of filterControls(spec)) state[filterControl.dim] = seedOf(filterControl)
  return state
}

function padded(values: readonly string[], slots: number): string[] {
  return Array.from({ length: slots }, (_, index) => values[Math.min(index, values.length - 1)] ?? '')
}

/**
 * The `<slug>_i` parameters every filtered dataset (`totals`, `by_time`,
 * `arm_totals`, `daily_trend`) needs, built from the current selection, plus
 * which dims could not be expressed in their fixed slot count.
 *
 * Fewer picks than slots repeats the last pick — `IN` is a set, so a repeat
 * is a no-op (verified by running the query in compose/datasets.mjs's `##
 * Filters`). More picks than slots cannot be expressed at all: the query
 * falls back to the control's full `options` list (its "everything" state)
 * and the caller is told which dim did that, so the FilterBar can say so.
 */
export function buildFilterParams(spec: Spec, filters: FiltersState): { readonly params: Readonly<Record<string, Scalar>>; readonly overflow: Readonly<Record<string, boolean>> } {
  const params: Record<string, Scalar> = {}
  const overflow: Record<string, boolean> = {}
  for (const filterControl of filterControls(spec)) {
    const seed = seedOf(filterControl)
    const slots = slotsOf(filterControl, seed)
    const selected = filters[filterControl.dim] ?? seed
    const over = selected.length > slots
    overflow[filterControl.dim] = over
    const source = over ? (filterControl.options ?? seed).map((value) => String(value)) : selected
    const values = padded(source, slots)
    const prefix = slug(filterControl.dim)
    values.forEach((value, index) => {
      params[`${prefix}_${index}`] = value
    })
  }
  return { params, overflow }
}

/** `from`/`to` plus `entity` (when the spec has one and the viewer picked it) — every declared query's baseline. */
export function baseParams(spec: Spec, time: TimeRange, entityId: string | undefined): Record<string, Scalar> {
  const base: Record<string, Scalar> = { from: time.from, to: time.to }
  if (spec.entity !== undefined && entityId !== undefined) base.entity = (spec.entity.type ?? 'number') === 'number' ? Number(entityId) : entityId
  return base
}

/**
 * Rows a query did not filter (`by_dimension`, `by_time_<dim>`, `segments`)
 * narrowed client-side by exact match. One filter at a time: a dataset
 * missing a filtered dim's column (a per-dim trend query only carries its
 * own dim) is simply not narrowed by that filter rather than dropped
 * entirely.
 */
export function filterRows<T extends Record<string, unknown>>(rows: readonly T[], filters: FiltersState): T[] {
  const active = Object.entries(filters).filter(([, values]) => values.length > 0)
  if (active.length === 0) return [...rows]
  return rows.filter((row) =>
    active.every(([dim, values]) => {
      if (!(dim in row)) return true
      return values.includes(String(row[dim]))
    }),
  )
}

/* ---------------------------------------------------------------- time */

const DAY_MS = 86_400_000
const isoDate = (date: Date) => date.toISOString().slice(0, 10)

/**
 * `spec.time.to`, resolved against `now` rather than the real clock — unlike
 * `spec.ts`'s `resolveTo`, this takes `now` as a parameter so every date this
 * module derives from it (including this one) is reproducible in a test with
 * a fixed `now`, and identical to `resolveTo` in production, where `now`
 * defaults to the real current time.
 */
function resolveToNow(to: string, now: Date): string {
  return to === 'tomorrow' ? isoDate(new Date(now.getTime() + DAY_MS)) : to
}

/**
 * A preset resolved against `now` (injectable for tests). `7d`/`30d`/`90d`
 * end at the spec's own `to` (so a spec fixed to a past window stays
 * self-consistent); `quarter`/`ytd` are genuinely "to date" — anchored on
 * the viewer's clock, not the spec's.
 */
export function presetRange(preset: TimePreset, spec: Spec, now: Date = new Date()): TimeRange {
  switch (preset) {
    case '7d':
    case '30d':
    case '90d': {
      const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
      const to = resolveToNow(spec.time.to, now)
      const from = isoDate(new Date(new Date(`${to}T00:00:00Z`).getTime() - days * DAY_MS))
      return { from, to }
    }
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3
      return { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))), to: isoDate(now) }
    }
    case 'ytd':
      return { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: isoDate(now) }
  }
}

/** The `time` control's declared presets, or the three short ones when it names none. */
export function timePresets(spec: Spec): readonly TimePreset[] {
  return control(spec, 'time')?.presets ?? ['7d', '30d', '90d']
}

/** The starting time state: the `time` control's default preset resolved, or the spec's own range. */
export function initialTime(spec: Spec, now: Date = new Date()): TimeState {
  const preset = control(spec, 'time')?.default as TimePreset | undefined
  if (preset === undefined) return { from: spec.time.from, to: resolveToNow(spec.time.to, now) }
  return { ...presetRange(preset, spec, now), preset }
}

/* ------------------------------------------------------------- provider */

export type ControlsState = {
  readonly filters: FiltersState
  readonly time: TimeState
}

export type ControlsActions = {
  /** Multi filter: add/remove one value. Dropping the last one falls back to "All" rather than leaving nothing selected. */
  toggleFilterValue(dim: string, value: string): void
  /** Single-select filter: replace the pick outright. */
  setFilterValue(dim: string, value: string): void
  /** The "All" chip: reset a filter to every option. */
  resetFilter(dim: string): void
  setPreset(preset: TimePreset): void
}

const ControlsContext = createContext<(ControlsState & ControlsActions) | undefined>(undefined)

export function ControlsProvider({ spec, children }: { spec: Spec; children: ReactNode }) {
  const [filters, setFilters] = useState<FiltersState>(() => initialFilters(spec))
  const [time, setTime] = useState<TimeState>(() => initialTime(spec))

  const controlsByDim = useMemo(() => {
    const map = new Map<string, FilterControl>()
    for (const filterControl of filterControls(spec)) map.set(filterControl.dim, filterControl)
    return map
  }, [spec])

  const optionsOf = (dim: string): string[] => {
    const filterControl = controlsByDim.get(dim)
    if (filterControl === undefined) return []
    return (filterControl.options ?? seedOf(filterControl)).map((value) => String(value))
  }

  const value = useMemo<ControlsState & ControlsActions>(
    () => ({
      filters,
      time,
      toggleFilterValue: (dim, val) => {
        setFilters((current) => {
          const options = optionsOf(dim)
          const selected = current[dim] ?? options
          if (controlsByDim.get(dim)?.multi !== true) return { ...current, [dim]: [val] }
          const next = selected.includes(val) ? selected.filter((picked) => picked !== val) : [...selected, val]
          return { ...current, [dim]: next.length === 0 ? options : next }
        })
      },
      setFilterValue: (dim, val) => setFilters((current) => ({ ...current, [dim]: [val] })),
      resetFilter: (dim) => setFilters((current) => ({ ...current, [dim]: optionsOf(dim) })),
      setPreset: (preset) => setTime({ ...presetRange(preset, spec), preset }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, time, controlsByDim, spec],
  )

  return <ControlsContext.Provider value={value}>{children}</ControlsContext.Provider>
}

export function useControls(): ControlsState & ControlsActions {
  const value = useContext(ControlsContext)
  if (value === undefined) throw new Error('useControls outside ControlsProvider')
  return value
}
