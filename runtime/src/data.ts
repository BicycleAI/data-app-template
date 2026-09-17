/**
 * Datasets, fetched through the declared queries and turned into the
 * structures recipes read. The core datasets exist for every spec; the
 * ab_test family adds its own.
 *
 * Every dataset is exposed as a `QueryState<T>`: `rows` is `undefined` until
 * its own query lands, alongside `isPending` (first load, no data to show
 * yet), `isFetching` (a background refetch — a control changed but the
 * previous rows are still on screen), `error` and `refetch`. Recipes read
 * `rows` and hand the rest to `Widget` (parts.tsx), which is what decides
 * whether to show a skeleton, the stale rows with a quiet refreshing state,
 * or an error with a Retry button. Nothing here ever collapses several
 * widgets' worth of state into one "loading" flag that blocks a whole page —
 * see AGENTS.md's "Widgets never blank" invariant.
 */

import { useMemo } from 'react'
import {
  applyRules,
  buildMeta,
  buildOverall,
  buildSegments,
  buildTrend,
  type Meta,
  num,
  parseDate,
  type Row,
  type Segment,
  str,
  type TrendPoint,
  type VariantOverall,
} from './analysis.js'
import { buildSeries, buildTotals, type Period, rollup, type Slice, type Totals } from './core.js'
import { baseParams, buildFilterParams, filterRows, useControls } from './controls.js'
import { type AbFamily, isAb, QUERY, type Spec, toAbSpec } from './spec.js'
import { toObjects } from './studio/client.js'
import { useAppQuery } from './studio/hooks.js'
import type { BdaError, QueryResult, Scalar } from './studio/types.js'

export type EntityOption = {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly status: string
  readonly group: string
  readonly rank: number
  readonly endDate: Date | undefined
}

export function useEntityList(spec: Spec): { options: EntityOption[]; loading: boolean; error: BdaError | null } {
  const entity = spec.entity
  const { time } = useControls()
  const list = useAppQuery(QUERY.entityList, { parameters: { from: time.from, to: time.to }, enabled: entity !== undefined })
  const options = useMemo<EntityOption[]>(() => {
    if (list.data === undefined || entity === undefined) return []
    const cfg = entity.list
    const byId = new Map<string, EntityOption>()
    for (const row of toObjects(list.data)) {
      const id = str(row[entity.field])
      if (id === '' || id === '0') continue
      const endDate = cfg?.end === undefined ? undefined : parseDate(row[cfg.end])
      const existing = byId.get(id)
      if (existing !== undefined && existing.endDate !== undefined && endDate !== undefined && existing.endDate > endDate) continue
      byId.set(id, {
        id,
        label: cfg?.label === undefined ? id : str(row[cfg.label]) || id,
        description: cfg?.description === undefined ? '' : str(row[cfg.description]),
        status: cfg?.status === undefined ? '' : str(row[cfg.status]),
        group: cfg?.group === undefined ? '' : str(row[cfg.group]),
        rank: cfg === undefined ? 0 : num(row[cfg.rank]),
        endDate,
      })
    }
    return [...byId.values()].sort((a, b) => b.rank - a.rank)
  }, [list.data, entity])
  return { options, loading: entity !== undefined && list.isPending, error: list.error }
}

const rows = (result: QueryResult | undefined) => (result === undefined ? undefined : toObjects(result))

/* ------------------------------------------------------------- query state */

/**
 * One query's worth of state, as every widget needs it.
 *
 * `rows` is the built value — not raw wire rows — so a recipe never re-runs
 * its own maths differently from another recipe reading the same query.
 */
export type QueryState<T> = {
  readonly rows: T | undefined
  readonly isPending: boolean
  readonly isFetching: boolean
  readonly error: BdaError | null
  readonly refetch: () => void
}

function pendingState<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

/**
 * Combine several queries a single widget depends on into one state: pending
 * until all have landed, fetching if any is refreshing, the first error if
 * any failed, and a retry that refetches every one of them.
 */
export function mergeQueries(...states: readonly Pick<QueryState<unknown>, 'isPending' | 'isFetching' | 'error' | 'refetch'>[]): Pick<QueryState<unknown>, 'isPending' | 'isFetching' | 'error' | 'refetch'> {
  return {
    isPending: states.some((state) => state.isPending),
    isFetching: states.some((state) => state.isFetching),
    error: states.find((state) => state.error !== null)?.error ?? null,
    refetch: () => {
      for (const state of states) state.refetch()
    },
  }
}

/* ------------------------------------------------------------------ core */

export type CoreData = {
  readonly totals: QueryState<Totals>
  readonly series: QueryState<readonly Period[]>
  /** The wide by-dimension pull. Recipes read `slicesAt`, not this, for values. */
  readonly dims: QueryState<readonly Row[]>
  /** The per-dimension time series a `trend` panel with `by` reads (one query per trend dimension). */
  trendBy(field: string): QueryState<readonly Row[]>
  /** Rolled-up slices for a set of dimensions. `[]` while `dims` is pending — gate the widget on `core.dims`, not on the length of this. */
  slicesAt(fields: readonly string[]): Slice[]
}

/** Which dimensions the panels ask a per-dimension time series for (recipe `trend` with `by`). */
export function trendDims(spec: Spec): string[] {
  const out = new Set<string>()
  for (const panel of spec.panels ?? []) {
    const by = panel.bind?.by
    if (typeof by === 'string' && spec.dimensions.some((dim) => dim.field === by)) out.add(by)
  }
  return [...out]
}

export function useCoreDataset(spec: Spec, entityId: string | undefined): CoreData {
  const { filters, time } = useControls()
  const ready = spec.entity === undefined || entityId !== undefined
  const base = baseParams(spec, time, entityId)
  const { params: filterSlots } = buildFilterParams(spec, filters)
  // `totals`/`by_time` are the datasets the composer declared `filters: true` on — the only ones
  // whose SQL carries the `<slug>_i` slots these params fill. `by_dimension`/`by_time_<dim>` keep
  // the dimension, so the query stays unfiltered and the pick is applied to their rows below.
  const filteredParameters: Record<string, Scalar> = { ...base, ...filterSlots }
  const totalsQ = useAppQuery(QUERY.totals, { parameters: filteredParameters, enabled: ready })
  const byTimeQ = useAppQuery(QUERY.byTime, { parameters: filteredParameters, limit: 5000, enabled: ready })
  const hasDims = spec.dimensions.length > 0
  const byDimQ = useAppQuery(QUERY.byDimension, { parameters: base, limit: 10000, enabled: ready && hasDims })
  const dims = trendDims(spec)
  // Hooks must be called unconditionally; the composer caps trend dims at 3.
  const bt0 = useAppQuery(QUERY.byTimeDim(dims[0] ?? ''), { parameters: base, limit: 5000, enabled: ready && dims[0] !== undefined })
  const bt1 = useAppQuery(QUERY.byTimeDim(dims[1] ?? ''), { parameters: base, limit: 5000, enabled: ready && dims[1] !== undefined })
  const bt2 = useAppQuery(QUERY.byTimeDim(dims[2] ?? ''), { parameters: base, limit: 5000, enabled: ready && dims[2] !== undefined })

  const totalRows = useMemo(() => rows(totalsQ.data), [totalsQ.data])
  const timeRows = useMemo(() => rows(byTimeQ.data), [byTimeQ.data])
  // `by_dimension`/`by_time_<dim>` are not narrowed by the query — filter their rows in memory.
  const dimRowsRaw = useMemo(() => rows(byDimQ.data), [byDimQ.data])
  const dimRows = useMemo(() => (dimRowsRaw === undefined ? undefined : filterRows(dimRowsRaw, filters)), [dimRowsRaw, filters])
  const bt0RowsRaw = useMemo(() => rows(bt0.data), [bt0.data])
  const bt0Rows = useMemo(() => (bt0RowsRaw === undefined ? undefined : filterRows(bt0RowsRaw, filters)), [bt0RowsRaw, filters])
  const bt1RowsRaw = useMemo(() => rows(bt1.data), [bt1.data])
  const bt1Rows = useMemo(() => (bt1RowsRaw === undefined ? undefined : filterRows(bt1RowsRaw, filters)), [bt1RowsRaw, filters])
  const bt2RowsRaw = useMemo(() => rows(bt2.data), [bt2.data])
  const bt2Rows = useMemo(() => (bt2RowsRaw === undefined ? undefined : filterRows(bt2RowsRaw, filters)), [bt2RowsRaw, filters])

  const totalsBuilt = useMemo(() => (totalRows === undefined ? undefined : buildTotals(spec, totalRows)), [spec, totalRows])
  const seriesBuilt = useMemo(() => (timeRows === undefined ? undefined : buildSeries(spec, timeRows)), [spec, timeRows])

  const totals: QueryState<Totals> = { rows: totalsBuilt, isPending: totalsQ.isPending, isFetching: totalsQ.isFetching, error: totalsQ.error, refetch: () => void totalsQ.refetch() }
  const series: QueryState<readonly Period[]> = { rows: seriesBuilt, isPending: byTimeQ.isPending, isFetching: byTimeQ.isFetching, error: byTimeQ.error, refetch: () => void byTimeQ.refetch() }
  const dimsState: QueryState<readonly Row[]> = hasDims
    ? { rows: dimRows, isPending: byDimQ.isPending, isFetching: byDimQ.isFetching, error: byDimQ.error, refetch: () => void byDimQ.refetch() }
    : { rows: [], isPending: false, isFetching: false, error: null, refetch: () => {} }
  const btStates: readonly QueryState<readonly Row[]>[] = [
    { rows: bt0Rows, isPending: bt0.isPending, isFetching: bt0.isFetching, error: bt0.error, refetch: () => void bt0.refetch() },
    { rows: bt1Rows, isPending: bt1.isPending, isFetching: bt1.isFetching, error: bt1.error, refetch: () => void bt1.refetch() },
    { rows: bt2Rows, isPending: bt2.isPending, isFetching: bt2.isFetching, error: bt2.error, refetch: () => void bt2.refetch() },
  ]

  const slicesCache = useMemo(() => new Map<string, Slice[]>(), [dimsState.rows])

  return {
    totals,
    series,
    dims: dimsState,
    trendBy(field) {
      const index = dims.indexOf(field)
      return index === -1 ? pendingState() : (btStates[index] ?? pendingState())
    },
    slicesAt(fields) {
      const key = fields.join(',')
      const hit = slicesCache.get(key)
      if (hit !== undefined) return hit
      const computed = dimsState.rows === undefined ? [] : rollup(spec, dimsState.rows, fields)
      slicesCache.set(key, computed)
      return computed
    },
  }
}

/* --------------------------------------------------------------- ab_test */

export type Dataset = {
  /** Experiment metadata (description, tag, status, window). Needs `experiment_meta` + `daily_trend` (the trend rows bound the test window). */
  readonly meta: QueryState<Meta>
  /** Per-arm KPIs. Needs `meta` (for the window's effective length) + `arm_totals`. */
  readonly overall: QueryState<readonly VariantOverall[]>
  /** Cumulative-to-date KPIs per day per variant. Needs `overall` + `daily_trend`. */
  readonly trend: QueryState<readonly TrendPoint[]>
  /** Rolled-up per-arm segments for a set of dimensions at a combination depth. Needs `overall` + the wide `segments` pull. */
  segmentsAt(fields: readonly string[], depth: number): QueryState<readonly Segment[]>
}

export function useAbDataset(spec: Spec & { family: AbFamily }, entityId: string): Dataset {
  const ab = useMemo(() => toAbSpec(spec), [spec])
  const { filters, time } = useControls()
  const base = baseParams(spec, time, entityId)
  const { params: filterSlots } = buildFilterParams(spec, filters)
  // `arm_totals`/`daily_trend` are declared `filters: true`; `experiment_meta`/`segments` keep the
  // dimension (or have none to narrow), so they run unfiltered and `segments`' rows are narrowed below.
  const filteredParameters: Record<string, Scalar> = { ...base, ...filterSlots }
  const metaQ = useAppQuery(QUERY.meta, { parameters: base })
  const totalsQ = useAppQuery(QUERY.armTotals, { parameters: filteredParameters })
  const wideQ = useAppQuery(QUERY.segments, { parameters: base, limit: 10000 })
  const dailyQ = useAppQuery(QUERY.trend, { parameters: filteredParameters, limit: 5000 })

  const metaRows = useMemo(() => rows(metaQ.data), [metaQ.data])
  const totalRows = useMemo(() => rows(totalsQ.data), [totalsQ.data])
  const wideRowsRaw = useMemo(() => rows(wideQ.data), [wideQ.data])
  const wideRows = useMemo(() => (wideRowsRaw === undefined ? undefined : filterRows(wideRowsRaw, filters)), [wideRowsRaw, filters])
  const dailyRows = useMemo(() => rows(dailyQ.data), [dailyQ.data])

  const metaBuilt = useMemo(() => {
    if (metaRows === undefined || dailyRows === undefined) return undefined
    return buildMeta(ab, entityId, metaRows, dailyRows.map((row) => str(row.day).slice(0, 10)))
  }, [ab, entityId, metaRows, dailyRows])

  const metaState: QueryState<Meta> = {
    rows: metaBuilt,
    isPending: metaQ.isPending || dailyQ.isPending,
    isFetching: metaQ.isFetching || dailyQ.isFetching,
    error: metaQ.error ?? dailyQ.error,
    refetch: () => {
      void metaQ.refetch()
      void dailyQ.refetch()
    },
  }

  const overallBuilt = useMemo(() => {
    if (metaBuilt === undefined || totalRows === undefined) return undefined
    return buildOverall(ab, totalRows, metaBuilt.window.effectiveTld)
  }, [ab, metaBuilt, totalRows])

  const overallState: QueryState<readonly VariantOverall[]> = {
    rows: overallBuilt,
    isPending: metaState.isPending || totalsQ.isPending,
    isFetching: metaState.isFetching || totalsQ.isFetching,
    error: metaState.error ?? totalsQ.error,
    refetch: () => {
      metaState.refetch()
      void totalsQ.refetch()
    },
  }

  const trendBuilt = useMemo(() => {
    if (metaBuilt === undefined || overallBuilt === undefined || dailyRows === undefined) return undefined
    return buildTrend(ab, dailyRows, overallBuilt, metaBuilt.window)
  }, [ab, metaBuilt, overallBuilt, dailyRows])

  const trendState: QueryState<readonly TrendPoint[]> = {
    rows: trendBuilt,
    isPending: overallState.isPending || dailyQ.isPending,
    isFetching: overallState.isFetching || dailyQ.isFetching,
    error: overallState.error ?? dailyQ.error,
    refetch: () => {
      overallState.refetch()
      void dailyQ.refetch()
    },
  }

  const segmentsCache = useMemo(() => new Map<string, Segment[]>(), [overallBuilt, wideRows])

  return {
    meta: metaState,
    overall: overallState,
    trend: trendState,
    segmentsAt(fields, depth) {
      const base = {
        isPending: overallState.isPending || wideQ.isPending,
        isFetching: overallState.isFetching || wideQ.isFetching,
        error: overallState.error ?? wideQ.error,
        refetch: () => {
          overallState.refetch()
          void wideQ.refetch()
        },
      }
      const key = `${fields.join(',')}|${depth}`
      const hit = segmentsCache.get(key)
      if (hit !== undefined) return { rows: hit, ...base }
      if (metaBuilt === undefined || overallBuilt === undefined || wideRows === undefined) return { rows: undefined, ...base }
      const computed = applyRules(ab, buildSegments(ab, wideRows, overallBuilt, fields, depth, metaBuilt.window.effectiveTld))
      segmentsCache.set(key, computed)
      return { rows: computed, ...base }
    },
  }
}

export { isAb }
