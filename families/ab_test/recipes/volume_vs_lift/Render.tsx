import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { CONFIDENCE_ORDER } from '../../../../runtime/src/analysis.js'
import { Chart, token } from '../../../../runtime/src/components/Chart.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtCompact, fmtCompactMoney, fmtInt, fmtSigned } from '../../../../runtime/src/format.js'
import { type RecipeProps, SectionHead, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { type Metric, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const segQuery = data.segmentsAt(ui.dims, 2)
  const query = mergeQueries(data.overall, segQuery)
  const rows = useMemo(
    () =>
      (variant === undefined ? [] : (segQuery.rows ?? []).filter((segment) => segment.variant === variant.name))
        .filter((segment) => segment.bookersVariant > 0)
        .map((segment) => ({ label: segment.label, bookers: segment.bookersVariant, lift: segment[metric], confidence: segment.confidence, nicpd: segment.NICPD })),
    [segQuery.rows, variant, metric],
  )
  type Dot = (typeof rows)[number]
  const options = useMemo(
    () => ({
      marginLeft: 56,
      marginBottom: 36,
      x: { type: 'log' as const, label: 'variant bookers →', tickFormat: (value: number) => fmtCompact(value) },
      y: { label: `${word(spec, metric)} ↑`, tickFormat: (value: number) => (metric === 'NICPD' ? fmtCompactMoney(value) : fmtCompact(value)) },
      color: {
        domain: [...CONFIDENCE_ORDER],
        range: [token('--bda-positive'), token('--bda-chart-3'), token('--bda-chart-1'), token('--bda-chart-4'), token('--bda-text-secondary')],
        legend: true,
        label: 'Z-test confidence',
      },
      marks: [
        Plot.ruleY([0], { stroke: 'var(--bda-border)' }),
        Plot.dot(rows, {
          x: 'bookers',
          y: 'lift',
          fill: 'confidence',
          r: 4,
          fillOpacity: 0.85,
          stroke: (d: Dot) => (d.lift > 0 && d.nicpd < 0 ? 'var(--bda-negative)' : 'none'),
          strokeWidth: 1.5,
          tip: true,
          title: (d: Dot) => `${d.label}\n${word(spec, metric)} ${fmtSigned(d.lift, metric === 'NICPD')}\n${word(spec, 'NICPD')} ${fmtSigned(d.nicpd, true)}\n${fmtInt(d.bookers)} variant bookers · ${d.confidence}`,
        }),
      ],
    }),
    [rows, metric, spec],
  )
  return (
    <Widget
      className="bda-card kit-panel"
      heading={<SectionHead title="Volume vs lift" right={<span className="bda-subtle">every two-dimension segment · hover a point</span>} />}
      skeleton={{ kind: 'chart', height: 320 }}
      {...widgetState(query)}
    >
      {rows.length === 0 ? <div className="bda-state">No segments.</div> : <Chart options={options} height={320} title="Segment volume versus lift" />}
      <div className="bda-subtle kit-caption">Points outlined in red gain bookings but lose net commerce — volume without profitability.</div>
    </Widget>
  )
}
