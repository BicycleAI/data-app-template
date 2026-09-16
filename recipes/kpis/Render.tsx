import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { Chart } from '../../runtime/src/components/Chart.js'
import { fmtDelta, fmtMeasure, isGood, type Period, periodChange } from '../../runtime/src/core.js'
import { mergeQueries } from '../../runtime/src/data.js'
import { type CoreProps, measureColor, Widget, widgetState } from '../../runtime/src/parts.js'
import { controlEnabled, type MeasureSpec, type Spec, word } from '../../runtime/src/spec.js'
import { useUi } from '../../runtime/src/ui.js'

/** One tile per measure: the window total, period-over-period change, and (spark style) a sparkline. Waits on `totals` + `series`. */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const style = bind.style === 'spark' ? 'spark' : 'row'
  const periods = spec.rules?.compare_periods ?? 7
  const measures = Array.isArray(bind.measures) ? spec.measures.filter((measure) => (bind.measures as string[]).includes(measure.id)) : spec.measures
  const query = mergeQueries(core.totals, core.series)
  return (
    <section className={style === 'spark' ? 'kit-kpis' : 'kit-ovrow'}>
      {measures.map((measure) => (
        <Tile
          key={measure.id}
          spec={spec}
          measure={measure}
          total={core.totals.rows?.[measure.id] ?? null}
          series={core.series.rows ?? []}
          periods={periods}
          spark={style === 'spark'}
          active={style === 'spark' && controlEnabled(spec, 'measure') && ui.measure === measure.id}
          query={query}
        />
      ))}
    </section>
  )
}

function Tile({
  spec,
  measure,
  total,
  series,
  periods,
  spark,
  active,
  query,
}: {
  spec: Spec
  measure: MeasureSpec
  total: number | null
  series: readonly Period[]
  periods: number
  spark: boolean
  active: boolean
  query: ReturnType<typeof mergeQueries>
}) {
  const change = periodChange(measure, series, periods)
  const good = isGood(measure, change.delta)
  const color = measureColor(spec, measure.id)
  const points = useMemo(() => series.flatMap((point) => (point.values[measure.id] === null ? [] : [{ period: point.period, value: point.values[measure.id] as number }])), [series, measure.id])
  const options = useMemo(
    () => ({
      marginLeft: 4,
      marginRight: 4,
      marginTop: 4,
      marginBottom: 4,
      x: { axis: null },
      y: { axis: null, grid: false },
      marks: [Plot.areaY(points, { x: 'period', y: 'value', fill: color, fillOpacity: 0.12 }), Plot.lineY(points, { x: 'period', y: 'value', stroke: color, strokeWidth: 2 })],
    }),
    [points, color],
  )
  const deltaColor = good === null ? 'var(--bda-text-secondary)' : good ? 'var(--bda-positive)' : 'var(--bda-negative)'
  if (!spark) {
    return (
      <Widget heading={<span className="kit-card__label">{word(spec, measure.id)}</span>} className="kit-card" skeleton={{ kind: 'metric' }} {...widgetState(query)}>
        <span className="kit-card__value">{fmtMeasure(total, measure.format, true)}</span>
        <span className="kit-card__hint" style={{ color: deltaColor }}>
          {change.delta === null ? 'no prior period' : `${fmtDelta(change, measure.format)} vs prior ${change.periods}${(spec.time.grain ?? 'day')[0]}`}
        </span>
      </Widget>
    )
  }
  return (
    <Widget
      heading={<div className="kit-kpi__label">{word(spec, measure.id)}</div>}
      className={`bda-card kit-kpi${active ? ' kit-kpi--active' : ''}`}
      style={{ borderTopColor: color }}
      skeleton={{ kind: 'metric' }}
      {...widgetState(query)}
    >
      <div className="kit-kpi__value">{fmtMeasure(total, measure.format, true)}</div>
      <div className="kit-kpi__sub" style={{ color: deltaColor }}>
        {change.delta === null ? 'no prior period to compare' : `${fmtDelta(change, measure.format)} · last ${change.periods} vs prior ${change.periods} ${spec.time.grain ?? 'day'}s`}
      </div>
      {points.length > 1 ? <Chart options={options} height={56} title={`${measure.label} trend`} className="kit-spark" /> : null}
    </Widget>
  )
}
