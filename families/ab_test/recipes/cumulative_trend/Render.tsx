import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import type { TrendPoint } from '../../../../runtime/src/analysis.js'
import { isoDay } from '../../../../runtime/src/analysis.js'
import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { Chart } from '../../../../runtime/src/components/Chart.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtCompact, fmtCompactMoney, fmtPct, fmtSigned } from '../../../../runtime/src/format.js'
import { Legend, METRIC_COLOR, METRIC_TITLE, type RecipeProps, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, armsOf, type Metric, type MetricOrCvr, QUERY, type Spec, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.overall` + `data.trend`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const query = mergeQueries(data.overall, data.trend)
  if (!query.isPending && variant === undefined) return null
  const measures = (Array.isArray(bind.measures) ? (bind.measures as MetricOrCvr[]) : ['NIBPD', 'NIBrPD', 'NICPD', 'CVR']) as MetricOrCvr[]
  const points = variant === undefined ? [] : (data.trend.rows ?? []).filter((point) => point.variant === variant.name)
  return (
    <section className="kit-section">
      <div className="kit-sh">Trends</div>
      <div className={measures.length === 1 ? '' : 'kit-grid2'}>
        {measures.map((measure) =>
          measure === 'CVR' ? (
            <CvrChart key="cvr" spec={spec} points={points} variant={variant?.name} query={query} />
          ) : (
            <TrendChart key={measure} spec={spec} metric={measure} points={points} variant={variant?.name} query={query} />
          ),
        )}
      </div>
    </section>
  )
}

type Point = { day: Date; value: number; series: string }

function TrendChart({ spec, metric, points, variant, query }: { spec: Spec; metric: Metric; points: readonly TrendPoint[]; variant: string | undefined; query: ReturnType<typeof mergeQueries> }) {
  const rows = useMemo<Point[]>(() => points.flatMap((point) => (point[metric] === null ? [] : [{ day: point.day, value: point[metric] as number, series: variant ?? '' }])), [points, metric, variant])
  const options = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => (metric === 'NICPD' ? fmtCompactMoney(value) : fmtCompact(value)) },
      x: { label: null },
      marks: [
        Plot.ruleY([0], { stroke: 'var(--bda-border)', strokeDasharray: '3,3' }),
        Plot.lineY(rows, { x: 'day', y: 'value', stroke: METRIC_COLOR[metric], strokeWidth: 2.5 }),
        Plot.dot(rows, { x: 'day', y: 'value', fill: METRIC_COLOR[metric], r: 3, tip: true, title: (d: Point) => `${isoDay(d.day)}: ${fmtSigned(d.value, metric === 'NICPD')}` }),
      ],
    }),
    [rows, metric],
  )
  const lastRow = rows[rows.length - 1]
  return (
    <Widget
      heading={
        <>
          <div className="kit-ct">
            {word(spec, metric)} {'—'} {METRIC_TITLE[metric]}
          </div>
          <div className="kit-cs">
            Cumulative-to-date, {variant ?? '…'} vs {armsOf(spec).control}
          </div>
          {variant === undefined ? null : <Legend items={[{ label: variant, color: METRIC_COLOR[metric] }]} />}
        </>
      }
      skeleton={{ kind: 'chart', height: 240 }}
      spec={spec}
      provenance={provenanceSpec({ queries: [QUERY.armTotals, QUERY.trend], measures: abRoleMeasureIds(spec), rowCount: rows.length || undefined, asOf: lastRow === undefined ? undefined : isoDay(lastRow.day) })}
      {...widgetState(query)}
    >
      {rows.length === 0 ? <div className="bda-state">No daily data.</div> : <Chart options={options} height={240} title={`${metric} trend`} />}
    </Widget>
  )
}

function CvrChart({ spec, points, variant, query }: { spec: Spec; points: readonly TrendPoint[]; variant: string | undefined; query: ReturnType<typeof mergeQueries> }) {
  const control = armsOf(spec).control
  const rows = useMemo<Point[]>(
    () =>
      points.flatMap((point) => [
        ...(point.cvr === null || variant === undefined ? [] : [{ day: point.day, value: point.cvr, series: variant }]),
        ...(point.cvrDefault === null ? [] : [{ day: point.day, value: point.cvrDefault, series: control }]),
      ]),
    [points, variant, control],
  )
  const options = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => fmtPct(value) },
      x: { label: null },
      marks: [
        Plot.lineY(rows.filter((d) => d.series !== control), { x: 'day', y: 'value', stroke: METRIC_COLOR.CVR, strokeWidth: 2.5 }),
        Plot.lineY(rows.filter((d) => d.series === control), { x: 'day', y: 'value', stroke: 'var(--bda-text-secondary)', strokeWidth: 2, strokeDasharray: '5,3' }),
        Plot.dot(rows, {
          x: 'day',
          y: 'value',
          fill: (d: Point) => (d.series === control ? 'var(--bda-text-secondary)' : METRIC_COLOR.CVR),
          r: (d: Point) => (d.series === control ? 2 : 3),
          tip: true,
          title: (d: Point) => `${d.series} ${isoDay(d.day)}: ${fmtPct(d.value)}`,
        }),
      ],
    }),
    [rows, control],
  )
  const lastRow = rows[rows.length - 1]
  return (
    <Widget
      heading={
        <>
          <div className="kit-ct">
            {word(spec, 'CVR')} {'—'} {METRIC_TITLE.CVR}
          </div>
          <div className="kit-cs">
            Cumulative bookers / participants, {variant ?? '…'} vs {control}
          </div>
          {variant === undefined ? null : <Legend items={[{ label: variant, color: METRIC_COLOR.CVR }, { label: control, color: 'var(--bda-text-secondary)', dashed: true }]} />}
        </>
      }
      skeleton={{ kind: 'chart', height: 240 }}
      spec={spec}
      provenance={provenanceSpec({ queries: [QUERY.armTotals, QUERY.trend], measures: abRoleMeasureIds(spec), rowCount: rows.length || undefined, asOf: lastRow === undefined ? undefined : isoDay(lastRow.day) })}
      {...widgetState(query)}
    >
      {rows.length === 0 ? <div className="bda-state">No daily data.</div> : <Chart options={options} height={240} title="Conversion rate trend" />}
    </Widget>
  )
}
