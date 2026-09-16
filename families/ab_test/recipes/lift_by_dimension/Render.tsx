import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import type { Segment } from '../../../../runtime/src/analysis.js'
import { Chart } from '../../../../runtime/src/components/Chart.js'
import { fmtCompact, fmtCompactMoney, fmtInt, fmtSigned } from '../../../../runtime/src/format.js'
import { type RecipeProps, SectionHead } from '../../../../runtime/src/parts.js'
import { armsOf, dimensionLabel, type Metric, type Spec, word } from '../../../../runtime/src/spec.js'
import { activeVariant, MetricChips, useUi } from '../../../../runtime/src/ui.js'

/** One small horizontal bar chart per dimension: the selected metric for every value, positives green, negatives red. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const limit = typeof bind.limit === 'number' ? bind.limit : 12
  const dims = bind.dims === 'first' ? spec.dimensions.slice(0, 1).map((dim) => dim.field) : Array.isArray(bind.dims) ? (bind.dims as string[]) : ui.dims
  const oneWay = useMemo(() => (variant === undefined ? [] : data.segmentsAt(dims, 1).filter((segment) => segment.variant === variant.name)), [data, dims, variant])
  return (
    <section className="kit-section">
      <SectionHead
        title="Lift by dimension"
        right={
          <span className="kit-sh__right">
            <span className="bda-subtle">{variant?.name} vs {armsOf(spec).control}</span>
            <MetricChips spec={spec} />
          </span>
        }
      />
      <div className="kit-dims">
        {dims.map((dim) => (
          <DimensionBars key={dim} spec={spec} dim={dim} metric={metric} limit={limit} segments={oneWay.filter((segment) => segment.dims[0] === dim)} />
        ))}
      </div>
    </section>
  )
}

function DimensionBars({ spec, dim, metric, limit, segments }: { spec: Spec; dim: string; metric: Metric; limit: number; segments: readonly Segment[] }) {
  const rows = useMemo(
    () =>
      [...segments]
        .map((segment) => ({ value: segment.values[0] ?? '', lift: segment[metric], bookers: segment.bookersVariant, confidence: segment.confidence }))
        .sort((a, b) => b.lift - a.lift)
        .slice(0, limit),
    [segments, metric, limit],
  )
  type Bar = (typeof rows)[number]
  const title = (d: Bar) => `${d.value}\n${word(spec, metric)} ${fmtSigned(d.lift, metric === 'NICPD')}\n${fmtInt(d.bookers)} variant bookers · ${d.confidence}`
  const options = useMemo(
    () => ({
      marginLeft: 110,
      marginRight: 12,
      marginTop: 4,
      marginBottom: 22,
      x: { label: null, tickFormat: (value: number) => (metric === 'NICPD' ? fmtCompactMoney(value) : fmtCompact(value)), ticks: 4 },
      y: { label: null, domain: rows.map((row) => row.value), tickSize: 0 },
      marks: [
        Plot.ruleX([0], { stroke: 'var(--bda-border)' }),
        Plot.barX(rows.filter((row) => row.lift >= 0), { x: 'lift', y: 'value', fill: 'var(--bda-positive)', rx: 3, tip: true, title }),
        Plot.barX(rows.filter((row) => row.lift < 0), { x: 'lift', y: 'value', fill: 'var(--bda-negative)', rx: 3, tip: true, title }),
      ],
    }),
    [rows, metric, title],
  )
  const positives = rows.filter((row) => row.lift > 0).length
  return (
    <div className="bda-card kit-dim">
      <div className="kit-dim__head">
        <span className="kit-dim__title">{dimensionLabel(spec, dim)}</span>
        <span className="bda-subtle">
          {positives}/{rows.length} up
        </span>
      </div>
      {rows.length === 0 ? <div className="bda-state">No paired values.</div> : <Chart options={options} height={Math.max(90, 18 + rows.length * 22)} title={`${metric} by ${dimensionLabel(spec, dim)}`} />}
    </div>
  )
}
