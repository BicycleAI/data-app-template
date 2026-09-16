/**
 * Datasets, fetched through the declared queries and turned into the
 * structures recipes read. The core datasets exist for every spec; the
 * ab_test family adds its own.
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
import { type AbFamily, isAb, QUERY, resolveTo, type Spec, toAbSpec } from './spec.js'
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
  const list = useAppQuery(QUERY.entityList, { parameters: { from: spec.time.from, to: resolveTo(spec.time.to) }, enabled: entity !== undefined })
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

function entityParameters(spec: Spec, entityId: string | undefined): Record<string, Scalar> {
  const base: Record<string, Scalar> = { from: spec.time.from, to: resolveTo(spec.time.to) }
  if (spec.entity !== undefined && entityId !== undefined) base.entity = (spec.entity.type ?? 'number') === 'number' ? Number(entityId) : entityId
  return base
}

const rows = (result: QueryResult | undefined) => (result === undefined ? undefined : toObjects(result))

/* ------------------------------------------------------------------ core */

export type CoreData = {
  readonly totals: Totals
  readonly series: readonly Period[]
  readonly wideRows: readonly Row[]
  readonly seriesBy: ReadonlyMap<string, readonly Row[]>
  slicesAt(dims: readonly string[]): Slice[]
}

export type CoreState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'empty' } | { status: 'ready'; data: CoreData }

/** Which dimensions the panels ask a per-dimension time series for (recipe `trend` with `by`). */
export function trendDims(spec: Spec): string[] {
  const out = new Set<string>()
  for (const panel of spec.panels ?? []) {
    const by = panel.bind?.by
    if (typeof by === 'string' && spec.dimensions.some((dim) => dim.field === by)) out.add(by)
  }
  return [...out]
}

export function useCoreDataset(spec: Spec, entityId: string | undefined): CoreState {
  const ready = spec.entity === undefined || entityId !== undefined
  const parameters = entityParameters(spec, entityId)
  const totals = useAppQuery(QUERY.totals, { parameters, enabled: ready })
  const byTime = useAppQuery(QUERY.byTime, { parameters, limit: 5000, enabled: ready })
  const hasDims = spec.dimensions.length > 0
  const byDim = useAppQuery(QUERY.byDimension, { parameters, limit: 10000, enabled: ready && hasDims })
  const dims = trendDims(spec)
  // Hooks must be called unconditionally; the composer caps trend dims at 3.
  const bt0 = useAppQuery(QUERY.byTimeDim(dims[0] ?? ''), { parameters, limit: 5000, enabled: ready && dims[0] !== undefined })
  const bt1 = useAppQuery(QUERY.byTimeDim(dims[1] ?? ''), { parameters, limit: 5000, enabled: ready && dims[1] !== undefined })
  const bt2 = useAppQuery(QUERY.byTimeDim(dims[2] ?? ''), { parameters, limit: 5000, enabled: ready && dims[2] !== undefined })

  const totalRows = useMemo(() => rows(totals.data), [totals.data])
  const timeRows = useMemo(() => rows(byTime.data), [byTime.data])
  const dimRows = useMemo(() => rows(byDim.data), [byDim.data])
  const btRows = [useMemo(() => rows(bt0.data), [bt0.data]), useMemo(() => rows(bt1.data), [bt1.data]), useMemo(() => rows(bt2.data), [bt2.data])]

  return useMemo<CoreState>(() => {
    if (!ready) return { status: 'loading' }
    const failure = totals.error ?? byTime.error ?? (hasDims ? byDim.error : null) ?? bt0.error ?? bt1.error ?? bt2.error
    if (failure !== null) return { status: 'error', message: failure.message }
    if (totalRows === undefined || timeRows === undefined || (hasDims && dimRows === undefined)) return { status: 'loading' }
    for (let index = 0; index < dims.length; index += 1) if (btRows[index] === undefined) return { status: 'loading' }
    const built = buildTotals(spec, totalRows)
    if (Object.values(built).every((value) => value === null) && timeRows.length === 0) return { status: 'empty' }
    const wideRows = dimRows ?? []
    const cache = new Map<string, Slice[]>()
    const seriesBy = new Map<string, readonly Row[]>()
    dims.forEach((dim, index) => seriesBy.set(dim, btRows[index] ?? []))
    return {
      status: 'ready',
      data: {
        totals: built,
        series: buildSeries(spec, timeRows),
        wideRows,
        seriesBy,
        slicesAt(fields) {
          const key = fields.join(',')
          const hit = cache.get(key)
          if (hit !== undefined) return hit
          const computed = rollup(spec, wideRows, fields)
          cache.set(key, computed)
          return computed
        },
      },
    }
  }, [spec, ready, hasDims, dims, totals.error, byTime.error, byDim.error, bt0.error, bt1.error, bt2.error, totalRows, timeRows, dimRows, btRows[0], btRows[1], btRows[2]])
}

/* --------------------------------------------------------------- ab_test */

export type Dataset = {
  readonly meta: Meta
  readonly overall: readonly VariantOverall[]
  readonly wideRows: readonly Row[]
  readonly trend: readonly TrendPoint[]
  segmentsAt(dims: readonly string[], depth: number): Segment[]
}

export type DatasetState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'empty' } | { status: 'ready'; data: Dataset }

export function useAbDataset(spec: Spec & { family: AbFamily }, entityId: string): DatasetState {
  const ab = useMemo(() => toAbSpec(spec), [spec])
  const parameters = entityParameters(spec, entityId)
  const meta = useAppQuery(QUERY.meta, { parameters })
  const totals = useAppQuery(QUERY.armTotals, { parameters })
  const wide = useAppQuery(QUERY.segments, { parameters, limit: 10000 })
  const daily = useAppQuery(QUERY.trend, { parameters, limit: 5000 })

  const metaRows = useMemo(() => rows(meta.data), [meta.data])
  const totalRows = useMemo(() => rows(totals.data), [totals.data])
  const wideRows = useMemo(() => rows(wide.data), [wide.data])
  const dailyRows = useMemo(() => rows(daily.data), [daily.data])

  return useMemo<DatasetState>(() => {
    const failure = meta.error ?? totals.error ?? wide.error ?? daily.error
    if (failure !== null) return { status: 'error', message: failure.message }
    if (metaRows === undefined || totalRows === undefined || wideRows === undefined || dailyRows === undefined) return { status: 'loading' }
    const built = buildMeta(ab, entityId, metaRows, dailyRows.map((row) => str(row.day).slice(0, 10)))
    if (built === undefined) return { status: 'empty' }
    const overall = buildOverall(ab, totalRows, built.window.effectiveTld)
    if (overall.length === 0) return { status: 'empty' }
    const trend = buildTrend(ab, dailyRows, overall, built.window)
    const cache = new Map<string, Segment[]>()
    return {
      status: 'ready',
      data: {
        meta: built,
        overall,
        wideRows,
        trend,
        segmentsAt(dims, depth) {
          const key = `${dims.join(',')}|${depth}`
          const hit = cache.get(key)
          if (hit !== undefined) return hit
          const computed = applyRules(ab, buildSegments(ab, wideRows, overall, dims, depth, built.window.effectiveTld))
          cache.set(key, computed)
          return computed
        },
      },
    }
  }, [ab, entityId, meta.error, totals.error, wide.error, daily.error, metaRows, totalRows, wideRows, dailyRows])
}

export { isAb }
