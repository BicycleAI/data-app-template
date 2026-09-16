import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { isoDay, str } from '../../runtime/src/analysis.js'
import { Chart } from '../../runtime/src/components/Chart.js'
import { fmtMeasure, isRate } from '../../runtime/src/core.js'
import { type CoreProps, Legend, measureColor, SectionHead } from '../../runtime/src/parts.js'
import { dimensionLabel, type MeasureSpec, measureById, primaryMeasure, type Spec, word } from '../../runtime/src/spec.js'
import { MeasureSelect, useUi } from '../../runtime/src/ui.js'

/**
 * A line per measure over time; with `by`, one line per value of a dimension
 * for the selected measure (top 6 values by the measure).
 */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const by = typeof bind.by === 'string' ? bind.by : undefined
  const measures: MeasureSpec[] =
    bind.measures === 'all' ? [...spec.measures] : bind.measures === 'primary' ? [primaryMeasure(spec)] : Array.isArray(bind.measures) ? spec.measures.filter((m) => (bind.measures as string[]).includes(m.id)) : [measureById(spec, ui.measure) ?? primaryMeasure(spec)]

  if (by !== undefined) return <ByDimension spec={spec} core={core} by={by} measure={measureById(spec, ui.measure) ?? primaryMeasure(spec)} />

  return (
    <section className="kit-section">
      <SectionHead title="Trends" right={bind.measures === undefined ? <MeasureSelect spec={spec} /> : undefined} />
      <div className={measures.length === 1 ? '' : 'kit-grid2'}>
        {measures.map((measure) => (
          <TrendChart key={measure.id} spec={spec} measure={measure} points={core.series.flatMap((p) => (p.values[measure.id] === null ? [] : [{ period: p.period, value: p.values[measure.id] as number }]))} />
        ))}
      </div>
    </section>
  )
}

type Point = { period: Date; value: number; series?: string }

function TrendChart({ spec, measure, points }: { spec: Spec; measure: MeasureSpec; points: readonly Point[] }) {
  const color = measureColor(spec, measure.id)
  const options = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => fmtMeasure(value, measure.format, true), ...(isRate(measure) ? {} : { zero: true }) },
      x: { label: null },
      marks: [
        Plot.areaY(points, { x: 'period', y: 'value', fill: color, fillOpacity: 0.08, curve: 'monotone-x' }),
        Plot.lineY(points, { x: 'period', y: 'value', stroke: color, strokeWidth: 2.5, curve: 'monotone-x' }),
        Plot.dot(points, { x: 'period', y: 'value', fill: color, r: 2.5, tip: true, title: (d: Point) => `${isoDay(d.period)}: ${fmtMeasure(d.value, measure.format)}` }),
      ],
    }),
    [points, color, measure],
  )
  return (
    <div className="bda-card">
      <div className="kit-ct">{word(spec, measure.id)}</div>
      <div className="kit-cs">per {spec.time.grain ?? 'day'}</div>
      {points.length === 0 ? <div className="bda-state">No data.</div> : <Chart options={options} height={220} title={`${measure.label} trend`} />}
    </div>
  )
}

function ByDimension({ spec, core, by, measure }: { spec: Spec; core: CoreProps['core']; by: string; measure: MeasureSpec }) {
  const rows = core.seriesBy.get(by) ?? []
  const data = useMemo<Point[]>(() => {
    const totals = new Map<string, number>()
    const points: Point[] = []
    for (const row of rows) {
      const key = str(row.period).slice(0, 10)
      const series = str(row[by])
      const raw = row[measure.column]
      if (key.length !== 10 || series === '' || raw === null || raw === undefined || raw === '') continue
      const value = Number(raw)
      points.push({ period: new Date(`${key}T00:00:00Z`), value, series })
      totals.set(series, (totals.get(series) ?? 0) + (isRate(measure) ? 1 : value))
    }
    const keep = new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([series]) => series))
    return points.filter((point) => keep.has(point.series ?? ''))
  }, [rows, by, measure])
  const options = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => fmtMeasure(value, measure.format, true) },
      x: { label: null },
      color: { legend: true },
      marks: [
        Plot.lineY(data, { x: 'period', y: 'value', stroke: 'series', strokeWidth: 2, curve: 'monotone-x', tip: true, title: (d: Point) => `${d.series} ${isoDay(d.period)}: ${fmtMeasure(d.value, measure.format)}` }),
      ],
    }),
    [data, measure],
  )
  return (
    <div className="bda-card kit-panel">
      <SectionHead title={`${word(spec, measure.id)} by ${dimensionLabel(spec, by)}`} right={<MeasureSelect spec={spec} />} />
      <div className="kit-cs">top 6 values by {word(spec, measure.id)}</div>
      {data.length === 0 ? <div className="bda-state">No data.</div> : <Chart options={options} height={280} title={`${measure.label} by ${dimensionLabel(spec, by)}`} />}
    </div>
  )
}
