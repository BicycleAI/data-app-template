/**
 * T3.3's contract with `compose/datasets.mjs`'s `## Filters`: a viewer's pick
 * has to become the same fixed-arity `<slug>_i` parameters the composer
 * rendered the query's SQL with, padding by repeating the last pick and
 * falling back to "all options" (with a flag) when the pick is wider than
 * the slots. Also covers the client-side filtering `by_dimension`/
 * `by_time_<dim>`/`segments` rows need (the query never narrows them), and
 * the time-preset arithmetic, against a fixed `now` so it never flakes.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { filtersOf } from '../compose/datasets.mjs'
import { buildFilterParams, filterRows, initialFilters, initialTime, presetRange, slotsOf } from '../runtime/src/controls.js'
import type { FilterControl, Spec } from '../runtime/src/spec.js'

/** Synthetic — no real customer model, field or dimension name. */
const SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-08-01', to: 'tomorrow', grain: 'day' },
  measures: [{ id: 'orders', column: 'orders_total', label: 'Orders', format: 'number', role: 'primary' }],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
  ],
  questions: [],
  controls: [
    // 8 options, multi, no explicit `slots` — the composer caps at 5, so picking 6+ overflows.
    { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac', 'latam', 'anzu', 'nordics', 'benelux', 'dach'], default: ['emea', 'amer'] },
    // single-select: always exactly 1 slot.
    { kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'], default: 'web' },
    { kind: 'time', presets: ['7d', '30d', '90d', 'quarter', 'ytd'], default: '30d' },
  ],
}

const region = SPEC.controls?.[0] as FilterControl
const channel = SPEC.controls?.[1] as FilterControl

describe('initialFilters', () => {
  it('seeds a multi filter from its default and a single-select from its default', () => {
    expect(initialFilters(SPEC)).toEqual({ region: ['emea', 'amer'], channel: ['web'] })
  })

  it('falls back to every option when a filter names no default', () => {
    const noDefault: Spec = { ...SPEC, controls: [{ kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'] }] }
    expect(initialFilters(noDefault)).toEqual({ region: ['emea', 'amer', 'apac'] })
  })
})

describe('slotsOf', () => {
  it('is always 1 for a single-select filter', () => {
    expect(slotsOf(channel, ['web'])).toBe(1)
  })

  it('is the option count for a multi filter with 5 or fewer options', () => {
    const threeOptions: FilterControl = { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'] }
    expect(slotsOf(threeOptions, ['emea', 'amer', 'apac'])).toBe(3)
  })

  it('caps a multi filter at 5 slots regardless of how many options it has', () => {
    expect(slotsOf(region, region.options?.map(String) ?? [])).toBe(5)
  })
})

describe('buildFilterParams', () => {
  it('(a) default selection: one param per slot, repeating the last pick to fill the rest', () => {
    const { params, overflow } = buildFilterParams(SPEC, initialFilters(SPEC))
    // region: multi, 8 options -> 5 slots; default picks 2 -> padded by repeating "amer".
    expect(params).toMatchObject({ region_0: 'emea', region_1: 'amer', region_2: 'amer', region_3: 'amer', region_4: 'amer' })
    // channel: single-select -> exactly 1 slot.
    expect(params).toMatchObject({ channel_0: 'web' })
    expect(overflow).toEqual({ region: false, channel: false })
  })

  it('(b) one region picked: every slot repeats that single pick', () => {
    const { params, overflow } = buildFilterParams(SPEC, { region: ['apac'], channel: ['app'] })
    expect(params).toMatchObject({ region_0: 'apac', region_1: 'apac', region_2: 'apac', region_3: 'apac', region_4: 'apac', channel_0: 'app' })
    expect(overflow.region).toBe(false)
  })

  it('(c) six regions picked (more than the 5 slots): falls back to all options and flags the overflow', () => {
    const sixPicked = ['emea', 'amer', 'apac', 'latam', 'anzu', 'nordics']
    const { params, overflow } = buildFilterParams(SPEC, { region: sixPicked, channel: ['web'] })
    // Slots repeat the first 5 of the control's full `options` list — not the viewer's 6 picks,
    // which cannot be expressed in 5 scalar parameters.
    expect(params).toMatchObject({ region_0: 'emea', region_1: 'amer', region_2: 'apac', region_3: 'latam', region_4: 'anzu' })
    expect(overflow.region).toBe(true)
    expect(overflow.channel).toBe(false)
  })

  it('a single-select filter with its one pick in state never overflows its one slot', () => {
    const { overflow } = buildFilterParams(SPEC, { region: ['emea'], channel: ['web'] })
    expect(overflow.channel).toBe(false)
  })
})

describe('filterRows — client-side narrowing for by_dimension/by_time_<dim>/segments', () => {
  const rows = [
    { region: 'emea', channel: 'web', orders_total: 10 },
    { region: 'amer', channel: 'web', orders_total: 20 },
    { region: 'amer', channel: 'app', orders_total: 30 },
    { region: 'apac', channel: 'store', orders_total: 40 },
  ]

  it('keeps only rows whose every filtered dim matches the selection', () => {
    expect(filterRows(rows, { region: ['amer'], channel: [] })).toEqual([rows[1], rows[2]])
    expect(filterRows(rows, { region: ['amer'], channel: ['app'] })).toEqual([rows[2]])
  })

  it('an empty selection for a dim leaves that dim unfiltered', () => {
    expect(filterRows(rows, { region: [], channel: [] })).toEqual(rows)
  })

  it('does not drop a row for a filtered dim it does not carry as a column (a by_time_<dim> pull with a different dim)', () => {
    const byTimeChannel = [
      { period: '2026-08-01', channel: 'web', orders_total: 5 },
      { period: '2026-08-01', channel: 'app', orders_total: 6 },
    ]
    // `region` narrows the app, but this dataset has no `region` column — it is not narrowed by it.
    expect(filterRows(byTimeChannel, { region: ['emea'], channel: ['web'] })).toEqual([byTimeChannel[0]])
  })
})

describe('presetRange — time-preset arithmetic against a fixed `now`', () => {
  const NOW = new Date('2026-09-16T12:00:00Z')

  it('7d/30d/90d end at the spec\'s own `to` ("tomorrow" resolved), not at `now`', () => {
    expect(presetRange('7d', SPEC, NOW)).toEqual({ from: '2026-09-10', to: '2026-09-17' })
    expect(presetRange('30d', SPEC, NOW)).toEqual({ from: '2026-08-18', to: '2026-09-17' })
    expect(presetRange('90d', SPEC, NOW)).toEqual({ from: '2026-06-19', to: '2026-09-17' })
  })

  it('quarter is the current quarter to date, anchored on `now`', () => {
    // 2026-09-16 is in Q3 (Jul-Sep) -> quarter start is 2026-07-01.
    expect(presetRange('quarter', SPEC, NOW)).toEqual({ from: '2026-07-01', to: '2026-09-16' })
  })

  it('ytd is Jan 1 to date, anchored on `now`', () => {
    expect(presetRange('ytd', SPEC, NOW)).toEqual({ from: '2026-01-01', to: '2026-09-16' })
  })

  it('initialTime resolves the time control\'s default preset', () => {
    expect(initialTime(SPEC, NOW)).toEqual({ from: '2026-08-18', to: '2026-09-17', preset: '30d' })
  })

  it('initialTime falls back to the spec\'s own range when there is no time control', () => {
    const noTimeControl: Spec = { ...SPEC, controls: SPEC.controls?.filter((c) => c.kind !== 'time') }
    expect(initialTime(noTimeControl, NOW)).toEqual({ from: '2026-08-01', to: '2026-09-17' })
  })
})

describe('agrees with compose/datasets.mjs on the real filtered example (harness step 7)', () => {
  // `filtersOf` is the composer's own render of a spec's filter controls into parameters —
  // exactly what ends up in the manifest's `totals`/`by_time` query. The runtime never reads
  // that manifest (only `window.__DATA_APP_SPEC`), so this is the check that `buildFilterParams`
  // reconstructs the same slot count and the same default values independently.
  const raw: unknown = JSON.parse(readFileSync('spec/examples/retail-orders-health-filtered.json', 'utf8'))
  const filteredSpec = raw as Spec

  it('renders the same parameter names and default values as the composer, for the default selection', () => {
    const composed = filtersOf(filteredSpec) as readonly { readonly parameters: readonly { readonly name: string; readonly default: string }[] }[]
    const { params } = buildFilterParams(filteredSpec, initialFilters(filteredSpec))
    const composedParams = Object.fromEntries(composed.flatMap((filter) => filter.parameters.map((parameter) => [parameter.name, parameter.default])))
    expect(params).toEqual(composedParams)
    // Concretely, for this spec: region (multi, 3 options, default emea+amer) -> 3 slots, padded
    // by repeating "amer"; channel (single-select, default web) -> 1 slot.
    expect(params).toEqual({ region_0: 'emea', region_1: 'amer', region_2: 'amer', channel_0: 'web' })
  })
})
