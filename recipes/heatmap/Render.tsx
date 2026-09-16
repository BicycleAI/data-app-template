import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { Chart } from '../../runtime/src/components/Chart.js'
import { fmtMeasure } from '../../runtime/src/core.js'
import { type CoreProps, SectionHead, Widget, widgetState } from '../../runtime/src/parts.js'
import { dimensionLabel, measureById, primaryMeasure, word } from '../../runtime/src/spec.js'
import { usePanelId, useSelection } from '../../runtime/src/studio/contextRegistry.js'
import { HeatmapAxes, useUi } from '../../runtime/src/ui.js'

/** The selected measure where two dimensions meet; click a cell to select it. Waits on `core.dims`. */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const measure = (typeof bind.measure === 'string' ? measureById(spec, bind.measure) : undefined) ?? measureById(spec, ui.measure) ?? primaryMeasure(spec)
  const rowsDim = typeof bind.rows === 'string' ? bind.rows : ui.heatRows
  const colsDim = typeof bind.cols === 'string' ? bind.cols : ui.heatCols
  const panelId = usePanelId()
  const cells = useMemo(() => {
    if (rowsDim === colsDim || rowsDim === '' || colsDim === '') return []
    const slices = core.slicesAt([rowsDim, colsDim])
    const byRow = new Map<string, number>()
    for (const slice of slices) byRow.set(slice.values[0] ?? '', (byRow.get(slice.values[0] ?? '') ?? 0) + slice.weight)
    const byCol = new Map<string, number>()
    for (const slice of slices) byCol.set(slice.values[1] ?? '', (byCol.get(slice.values[1] ?? '') ?? 0) + slice.weight)
    const keepRows = new Set([...byRow.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k))
    const keepCols = new Set([...byCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k))
    return slices
      .filter((slice) => keepRows.has(slice.values[0] ?? '') && keepCols.has(slice.values[1] ?? '') && slice.measures[measure.id] !== null)
      .map((slice) => ({ row: slice.values[0] ?? '', col: slice.values[1] ?? '', value: slice.measures[measure.id] as number, label: slice.label }))
  }, [core, rowsDim, colsDim, measure.id])
  type Cell = (typeof cells)[number]
  const [selected, setSelected] = useSelection<Cell>(panelId)
  const onPointer = (value: unknown) => {
    const cell = value as Cell | null | undefined
    setSelected(cell === null || cell === undefined ? undefined : cell)
  }
  const options = useMemo(
    () => ({
      marginLeft: 130,
      marginBottom: 70,
      padding: 0.06,
      x: { label: null, domain: [...new Set(cells.map((cell) => cell.col))], tickRotate: -30 },
      y: { label: null, domain: [...new Set(cells.map((cell) => cell.row))] },
      color: { type: 'linear' as const, scheme: 'YlGnBu' as const, legend: true, label: word(spec, measure.id) },
      marks: [
        Plot.cell(cells, { x: 'col', y: 'row', fill: 'value', rx: 4, tip: true, title: (d: Cell) => `${d.label}\n${word(spec, measure.id)}: ${fmtMeasure(d.value, measure.format)}` }),
        Plot.text(cells, { x: 'col', y: 'row', text: (d: Cell) => fmtMeasure(d.value, measure.format, true), fill: 'currentColor', fontSize: 10 }),
        // A click-to-select cell, tracked by Plot's own nearest-neighbour pointer — see `Chart`'s `onPointer`.
        Plot.cell(cells, Plot.pointer({ x: 'col', y: 'row', stroke: 'var(--bda-accent)', strokeWidth: 3, fill: 'none', rx: 4 })),
      ],
    }),
    [cells, measure, spec],
  )
  const rowCount = new Set(cells.map((cell) => cell.row)).size
  const digest = useMemo(
    () =>
      [...cells]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((cell) => ({ [rowsDim]: cell.row, [colsDim]: cell.col, [measure.id]: cell.value })),
    [cells, rowsDim, colsDim, measure.id],
  )
  return (
    <Widget
      className="bda-card kit-panel"
      heading={<SectionHead title={`${dimensionLabel(spec, rowsDim)} × ${dimensionLabel(spec, colsDim)}`} right={<HeatmapAxes spec={spec} />} />}
      skeleton={{ kind: 'chart', height: 320 }}
      digest={digest}
      {...widgetState(core.dims)}
    >
      {rowsDim === colsDim ? (
        <div className="bda-state">Pick two different dimensions.</div>
      ) : cells.length === 0 ? (
        <div className="bda-state">No cells.</div>
      ) : (
        <>
          <Chart options={options} height={Math.min(520, Math.max(220, 100 + rowCount * 34))} title={`${measure.label} heatmap`} onPointer={onPointer} />
          {selected !== undefined ? (
            <p className="kit-caption bda-subtle">
              Selected: {selected.label} · {fmtMeasure(selected.value, measure.format)}
            </p>
          ) : null}
        </>
      )}
    </Widget>
  )
}
