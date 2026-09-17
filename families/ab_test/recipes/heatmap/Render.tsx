import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { Chart } from '../../../../runtime/src/components/Chart.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtCompact, fmtCompactMoney, fmtInt, fmtSigned } from '../../../../runtime/src/format.js'
import { type RecipeProps, SectionHead, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, dimensionLabel, type Metric, QUERY, word } from '../../../../runtime/src/spec.js'
import { activeVariant, HeatmapAxes, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const rowsDim = typeof bind.rows === 'string' && bind.rows !== 'ui' ? bind.rows : ui.heatRows
  const colsDim = typeof bind.cols === 'string' && bind.cols !== 'ui' ? bind.cols : ui.heatCols
  const segQuery = data.segmentsAt([rowsDim, colsDim], 2)
  const query = mergeQueries(data.overall, segQuery)
  const cells = useMemo(() => {
    if (variant === undefined || rowsDim === colsDim) return []
    return (segQuery.rows ?? [])
      .filter((segment) => segment.variant === variant.name)
      .map((segment) => ({
        row: segment.values[segment.dims.indexOf(rowsDim)] ?? '',
        col: segment.values[segment.dims.indexOf(colsDim)] ?? '',
        value: segment[metric],
        bookers: segment.bookersVariant,
        confidence: segment.confidence,
        label: segment.label,
      }))
  }, [segQuery.rows, variant, rowsDim, colsDim, metric])
  type Cell = (typeof cells)[number]
  const options = useMemo(() => {
    const extent = Math.max(...cells.map((cell) => Math.abs(cell.value)), 1)
    return {
      marginLeft: 120,
      marginBottom: 60,
      padding: 0.06,
      x: { label: null, domain: [...new Set(cells.map((cell) => cell.col))].sort(), tickRotate: -30 },
      y: { label: null, domain: [...new Set(cells.map((cell) => cell.row))].sort() },
      color: { type: 'diverging' as const, domain: [-extent, extent], scheme: 'PiYG' as const, legend: true, label: word(spec, metric) },
      marks: [
        Plot.cell(cells, { x: 'col', y: 'row', fill: 'value', rx: 4, tip: true, title: (d: Cell) => `${d.label}\n${word(spec, metric)} ${fmtSigned(d.value, metric === 'NICPD')}\n${fmtInt(d.bookers)} variant bookers · ${d.confidence}` }),
        Plot.text(cells, {
          x: 'col',
          y: 'row',
          text: (d: Cell) => (metric === 'NICPD' ? fmtCompactMoney(d.value) : fmtCompact(d.value)),
          fill: (d: Cell) => (Math.abs(d.value) > extent * 0.55 ? 'white' : 'currentColor'),
          fontSize: 10,
        }),
      ],
    }
  }, [cells, metric, spec])
  const rowCount = new Set(cells.map((cell) => cell.row)).size
  return (
    <Widget
      className="bda-card kit-panel"
      heading={<SectionHead title={`${dimensionLabel(spec, rowsDim)} × ${dimensionLabel(spec, colsDim)}`} right={<HeatmapAxes spec={spec} />} />}
      skeleton={{ kind: 'chart', height: 320 }}
      spec={spec}
      provenance={provenanceSpec({ queries: [QUERY.armTotals, QUERY.segments], measures: abRoleMeasureIds(spec), rowCount: cells.length || undefined })}
      {...widgetState(query)}
    >
      {rowsDim === colsDim ? (
        <div className="bda-state">Pick two different dimensions.</div>
      ) : cells.length === 0 ? (
        <div className="bda-state">No paired cells for these two dimensions.</div>
      ) : (
        <Chart options={options} height={Math.min(520, Math.max(220, 90 + rowCount * 34))} title={`${metric} heatmap`} />
      )}
    </Widget>
  )
}
