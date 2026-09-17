import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { Chart } from '../../runtime/src/components/Chart.js'
import { fmtMeasure, type Slice, topBy } from '../../runtime/src/core.js'
import { type CoreProps, measureColor, SectionHead, Widget, widgetState } from '../../runtime/src/parts.js'
import { dimensionLabel, type MeasureSpec, measureById, primaryMeasure, type Spec, word } from '../../runtime/src/spec.js'
import { MeasureSelect, useUi } from '../../runtime/src/ui.js'

/** One horizontal bar chart per dimension: the selected measure for each value, largest first. Waits on `core.dims`. */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const measure = (typeof bind.measure === 'string' ? measureById(spec, bind.measure) : undefined) ?? measureById(spec, ui.measure) ?? primaryMeasure(spec)
  const limit = typeof bind.limit === 'number' ? bind.limit : 10
  const dims = bind.dims === 'first' ? spec.dimensions.slice(0, 1).map((dim) => dim.field) : Array.isArray(bind.dims) ? (bind.dims as string[]) : ui.dims
  if (dims.length === 0) return null
  return (
    <section className="kit-section">
      <SectionHead title={`${word(spec, measure.id)} by dimension`} right={bind.measure === undefined ? <MeasureSelect spec={spec} /> : undefined} />
      <div className="kit-dims">
        {dims.map((dim) => (
          <Bars key={dim} spec={spec} dim={dim} measure={measure} slices={core.slicesAt([dim])} query={core.dims} limit={limit} />
        ))}
      </div>
    </section>
  )
}

function Bars({ spec, dim, measure, slices, query, limit }: { spec: Spec; dim: string; measure: MeasureSpec; slices: readonly Slice[]; query: CoreProps['core']['dims']; limit: number }) {
  const rows = useMemo(() => topBy(slices, measure.id, limit).map((slice) => ({ value: slice.values[0] ?? '', amount: slice.measures[measure.id] ?? 0, weight: slice.weight })), [slices, measure.id, limit])
  const color = measureColor(spec, measure.id)
  const options = useMemo(
    () => ({
      marginLeft: 120,
      marginRight: 12,
      marginTop: 4,
      marginBottom: 22,
      x: { label: null, tickFormat: (value: number) => fmtMeasure(value, measure.format, true), ticks: 4 },
      y: { label: null, domain: rows.map((row) => row.value), tickSize: 0 },
      marks: [Plot.barX(rows, { x: 'amount', y: 'value', fill: color, rx: 3, tip: true, title: (d: (typeof rows)[number]) => `${d.value}\n${word(spec, measure.id)}: ${fmtMeasure(d.amount, measure.format)}` })],
    }),
    [rows, color, measure, spec],
  )
  return (
    <Widget
      className="bda-card kit-dim"
      heading={
        <div className="kit-dim__head">
          <span className="kit-dim__title">{dimensionLabel(spec, dim)}</span>
          <span className="bda-subtle">top {rows.length}</span>
        </div>
      }
      skeleton={{ kind: 'chart', height: Math.max(90, 18 + limit * 22) }}
      {...widgetState(query)}
    >
      {rows.length === 0 ? <div className="bda-state">No values.</div> : <Chart options={options} height={Math.max(90, 18 + rows.length * 22)} title={`${measure.label} by ${dimensionLabel(spec, dim)}`} />}
    </Widget>
  )
}
