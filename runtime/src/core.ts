/**
 * Generic maths over the core datasets: totals, period-over-period change,
 * breakdowns by dimension, rankings and a plain-language movement statement.
 * Metrics arrive pre-aggregated from the semantic layer; nothing here
 * re-aggregates a rate — averages of averages are avoided by reading the
 * model's own totals row for headline numbers.
 */

import { num, str } from './analysis.js'
import type { Format, MeasureSpec, Spec } from './spec.js'

export type Row = Record<string, unknown>

export type Period = { readonly period: Date; readonly key: string; readonly values: Readonly<Record<string, number | null>> }

export function buildSeries(spec: Spec, rows: readonly Row[]): Period[] {
  const byKey = new Map<string, Period>()
  for (const row of rows) {
    const key = str(row.period).slice(0, 10)
    if (key.length !== 10) continue
    const values: Record<string, number | null> = {}
    for (const measure of spec.measures) {
      const raw = row[measure.column]
      values[measure.id] = raw === null || raw === undefined || raw === '' ? null : num(raw)
    }
    byKey.set(key, { period: new Date(`${key}T00:00:00Z`), key, values })
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export type Totals = Readonly<Record<string, number | null>>

export function buildTotals(spec: Spec, rows: readonly Row[]): Totals {
  const first = rows[0]
  const totals: Record<string, number | null> = {}
  for (const measure of spec.measures) {
    const raw = first?.[measure.column]
    totals[measure.id] = raw === null || raw === undefined || raw === '' ? null : num(raw)
  }
  return totals
}

export type Change = { readonly recent: number | null; readonly previous: number | null; readonly delta: number | null; readonly pct: number | null; readonly periods: number }

/** Last N periods vs the N before. Rates are averaged; everything else is summed. */
export function periodChange(measure: MeasureSpec, series: readonly Period[], periods: number): Change {
  const valid = series.filter((point) => point.values[measure.id] !== null)
  const n = Math.min(periods, Math.floor(valid.length / 2))
  if (n === 0) return { recent: null, previous: null, delta: null, pct: null, periods: 0 }
  const recentSlice = valid.slice(-n)
  const previousSlice = valid.slice(-2 * n, -n)
  const fold = (slice: readonly Period[]) => {
    const values = slice.map((point) => point.values[measure.id] ?? 0)
    const sum = values.reduce((acc, value) => acc + value, 0)
    return isRate(measure) ? sum / values.length : sum
  }
  const recent = fold(recentSlice)
  const previous = fold(previousSlice)
  const delta = recent - previous
  return { recent, previous, delta, pct: previous === 0 ? null : delta / Math.abs(previous), periods: n }
}

export function isRate(measure: MeasureSpec): boolean {
  return measure.format === 'percent' || measure.format === 'rate'
}

export function isGood(measure: MeasureSpec, delta: number | null): boolean | null {
  if (delta === null || delta === 0) return null
  return (measure.good ?? 'up') === 'up' ? delta > 0 : delta < 0
}

export type Slice = { readonly key: string; readonly values: readonly string[]; readonly label: string; readonly measures: Readonly<Record<string, number | null>>; readonly weight: number }

const isMissing = (value: string) => {
  const lower = value.trim().toLowerCase()
  return lower === '' || lower === 'nan' || lower === 'none' || lower === 'null' || lower.includes('__missing__')
}

/**
 * Roll the wide by-dimension pull up to the requested dimensions. Sums are
 * exact; rates are weighted by the primary measure of the leaf when one is
 * present, else averaged. Leaves with a missing value on any requested
 * dimension are dropped.
 */
export function rollup(spec: Spec, rows: readonly Row[], dims: readonly string[]): Slice[] {
  const primary = spec.measures.find((measure) => measure.role === 'primary') ?? spec.measures[0]
  const labelOf = (field: string) => spec.dimensions.find((dim) => dim.field === field)?.label ?? field
  type Acc = { values: string[]; sums: Record<string, number>; weighted: Record<string, number>; weights: Record<string, number>; counts: Record<string, number>; weight: number }
  const buckets = new Map<string, Acc>()
  for (const row of rows) {
    const values = dims.map((dim) => str(row[dim]))
    if (values.some(isMissing)) continue
    const key = values.join('')
    let acc = buckets.get(key)
    if (acc === undefined) {
      acc = { values, sums: {}, weighted: {}, weights: {}, counts: {}, weight: 0 }
      buckets.set(key, acc)
    }
    const leafWeight = primary === undefined || isRate(primary) ? 1 : Math.max(num(row[primary.column]), 0)
    acc.weight += leafWeight
    for (const measure of spec.measures) {
      const raw = row[measure.column]
      if (raw === null || raw === undefined || raw === '') continue
      const value = num(raw)
      acc.sums[measure.id] = (acc.sums[measure.id] ?? 0) + value
      acc.counts[measure.id] = (acc.counts[measure.id] ?? 0) + 1
      const w = leafWeight > 0 ? leafWeight : 1
      acc.weighted[measure.id] = (acc.weighted[measure.id] ?? 0) + value * w
      acc.weights[measure.id] = (acc.weights[measure.id] ?? 0) + w
    }
  }
  return [...buckets.values()].map((acc) => {
    const measures: Record<string, number | null> = {}
    for (const measure of spec.measures) {
      const count = acc.counts[measure.id] ?? 0
      if (count === 0) measures[measure.id] = null
      else if (isRate(measure)) measures[measure.id] = (acc.weighted[measure.id] ?? 0) / (acc.weights[measure.id] ?? 1)
      else measures[measure.id] = acc.sums[measure.id] ?? 0
    }
    return { key: acc.values.join('|'), values: acc.values, label: dims.map((dim, index) => `${labelOf(dim)}=${acc.values[index] ?? ''}`).join(' × '), measures, weight: acc.weight }
  })
}

export function topBy(slices: readonly Slice[], measureId: string, count: number, direction: 'desc' | 'asc' = 'desc'): Slice[] {
  return slices
    .filter((slice) => slice.measures[measureId] !== null)
    .sort((a, b) => (direction === 'desc' ? (b.measures[measureId] ?? 0) - (a.measures[measureId] ?? 0) : (a.measures[measureId] ?? 0) - (b.measures[measureId] ?? 0)))
    .slice(0, count)
}

export function fmtMeasure(value: number | null, format: Format | undefined, compact = false): string {
  if (value === null || !Number.isFinite(value)) return '—'
  switch (format) {
    case 'currency':
      return compact ? compactMoney(value) : `$${Math.round(value).toLocaleString()}`
    case 'percent':
      return `${(value * 100).toFixed(2)}%`
    case 'rate':
      return `${value.toFixed(2)}%`
    default:
      return compact ? compactNumber(value) : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(Math.abs(value) < 10 ? 2 : 1)
  }
}

export function fmtDelta(change: Change, format: Format | undefined): string {
  if (change.delta === null) return '—'
  const sign = change.delta >= 0 ? '+' : '−'
  if (format === 'percent') return `${sign}${(Math.abs(change.delta) * 10_000).toFixed(0)} bps`
  if (format === 'rate') return `${sign}${Math.abs(change.delta).toFixed(2)} pts`
  const pct = change.pct === null ? '' : ` (${sign}${(Math.abs(change.pct) * 100).toFixed(1)}%)`
  return `${sign}${fmtMeasure(Math.abs(change.delta), format, true)}${pct}`
}

export function compactNumber(value: number): string {
  const sign = value < 0 ? '−' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toFixed(magnitude >= 10_000 ? 0 : 1)}k`
  return `${sign}${Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(magnitude < 10 ? 1 : 0)}`
}

export function compactMoney(value: number): string {
  const sign = value < 0 ? '−' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1000) return `${sign}$${(magnitude / 1000).toFixed(0)}k`
  return `${sign}$${magnitude.toFixed(0)}`
}

export type Finding = { readonly html: string; readonly tone: 'positive' | 'negative' | 'neutral' }

const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Deterministic findings: movement of each measure, and where a dimension concentrates or diverges. */
export function buildFindings(spec: Spec, totals: Totals, series: readonly Period[], slicesByDim: ReadonlyMap<string, readonly Slice[]>, periods: number): Finding[] {
  const findings: Finding[] = []
  const labelOf = (field: string) => spec.dimensions.find((dim) => dim.field === field)?.label ?? field
  for (const measure of spec.measures.slice(0, 4)) {
    const change = periodChange(measure, series, periods)
    if (change.delta === null) continue
    const good = isGood(measure, change.delta)
    const name = spec.words?.[measure.id] ?? measure.label
    findings.push({
      tone: good === null ? 'neutral' : good ? 'positive' : 'negative',
      html: `<b>${esc(name)}</b> moved <b>${esc(fmtDelta(change, measure.format))}</b> over the last ${change.periods} ${spec.time.grain ?? 'day'}s versus the ${change.periods} before (${esc(fmtMeasure(change.recent, measure.format, true))} vs ${esc(fmtMeasure(change.previous, measure.format, true))}).${good === false ? ' Moving the wrong way for this measure.' : ''}`,
    })
  }
  const primary = spec.measures.find((measure) => measure.role === 'primary') ?? spec.measures[0]
  if (primary !== undefined && !isRate(primary)) {
    const total = totals[primary.id] ?? null
    for (const [dim, slices] of slicesByDim) {
      const ranked = topBy(slices, primary.id, 3)
      const top = ranked[0]
      if (top === undefined || total === null || total <= 0) continue
      const share = (top.measures[primary.id] ?? 0) / total
      if (share >= 0.4) {
        findings.push({ tone: 'neutral', html: `<b>${esc(labelOf(dim))}</b> is concentrated: <b>${esc(top.values[0] ?? '')}</b> alone is ${(share * 100).toFixed(0)}% of ${esc(spec.words?.[primary.id] ?? primary.label)}.` })
      }
    }
  }
  const rates = spec.measures.filter(isRate).slice(0, 2)
  for (const rate of rates) {
    for (const [dim, slices] of slicesByDim) {
      const meaningful = slices.filter((slice) => slice.weight > 0 && slice.measures[rate.id] !== null)
      if (meaningful.length < 3) continue
      const worst = topBy(meaningful, rate.id, 1, (rate.good ?? 'up') === 'up' ? 'asc' : 'desc')[0]
      const best = topBy(meaningful, rate.id, 1, (rate.good ?? 'up') === 'up' ? 'desc' : 'asc')[0]
      if (worst === undefined || best === undefined || worst === best) continue
      findings.push({
        tone: 'negative',
        html: `On <b>${esc(spec.words?.[rate.id] ?? rate.label)}</b>, <b>${esc(labelOf(dim))}=${esc(worst.values[0] ?? '')}</b> is the outlier at <b>${esc(fmtMeasure(worst.measures[rate.id] ?? null, rate.format))}</b>, against ${esc(fmtMeasure(best.measures[rate.id] ?? null, rate.format))} for ${esc(best.values[0] ?? '')}.`,
      })
      break
    }
  }
  return findings.slice(0, 6)
}
