import { useMemo } from 'react'
import { provenanceSpec } from '../../runtime/src/chrome/Provenance.js'
import { fmtMeasure, type Slice, topBy } from '../../runtime/src/core.js'
import { type CoreProps, SectionHead, Widget, widgetState } from '../../runtime/src/parts.js'
import { dimensionLabel, measureById, primaryMeasure, QUERY, word } from '../../runtime/src/spec.js'
import { usePanelId, useSelection } from '../../runtime/src/studio/contextRegistry.js'
import { MeasureSelect, useUi } from '../../runtime/src/ui.js'

/** Top and bottom values of one dimension by the selected measure, with every other measure alongside. Waits on `core.dims`. */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const measure = (typeof bind.measure === 'string' ? measureById(spec, bind.measure) : undefined) ?? measureById(spec, ui.measure) ?? primaryMeasure(spec)
  const dim = typeof bind.dim === 'string' ? bind.dim : (ui.dims[0] ?? spec.dimensions[0]?.field)
  const count = typeof bind.count === 'number' ? bind.count : 8
  const panelId = usePanelId()
  const [selected, setSelected] = useSelection<Slice>(panelId)
  const slices = useMemo(() => (dim === undefined ? [] : core.slicesAt([dim])), [core, dim])
  if (dim === undefined) return null
  const ranked = slices.filter((slice) => slice.measures[measure.id] !== null)
  const top = topBy(ranked, measure.id, count, 'desc')
  // With few values the two tables would repeat each other; show one full ranking instead.
  const showBottom = ranked.length > count
  const bottom = showBottom ? topBy(ranked, measure.id, count, 'asc').filter((slice) => !top.includes(slice)) : []
  const others = spec.measures.filter((m) => m.id !== measure.id).slice(0, 3)
  const rowDigest = (slice: Slice) => ({
    [dim]: slice.values[0] ?? '',
    [measure.id]: slice.measures[measure.id],
    ...Object.fromEntries(others.map((m) => [m.id, slice.measures[m.id]])),
  })
  const provenanceBase = { queries: [QUERY.byDimension], measures: [measure.id, ...others.map((m) => m.id)] }
  const table = (title: string, rows: typeof top, digest?: unknown) => (
    <Widget
      className="bda-card kit-tcard"
      heading={<div className="kit-tcard__head"><span>{title}</span></div>}
      skeleton={{ kind: 'table', rows: count }}
      digest={digest}
      spec={spec}
      provenance={provenanceSpec({ ...provenanceBase, rowCount: rows.length || undefined })}
      {...widgetState(core.dims)}
    >
      {rows.length === 0 ? (
        <div className="bda-state">None.</div>
      ) : (
        <div className="kit-scroll">
          <table className="bda-table kit-table">
            <thead>
              <tr>
                <th>{dimensionLabel(spec, dim)}</th>
                <th className="bda-numeric">{word(spec, measure.id)}</th>
                {others.map((m) => (
                  <th key={m.id} className="bda-numeric">
                    {word(spec, m.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((slice) => {
                const isSelected = selected?.key === slice.key
                return (
                  <tr key={slice.key} className={isSelected ? 'kit-row kit-selected' : 'kit-row'} onClick={() => setSelected(isSelected ? undefined : slice)}>
                    <td>{slice.values[0]}</td>
                    <td className="bda-numeric kit-mono">{fmtMeasure(slice.measures[measure.id] ?? null, measure.format)}</td>
                    {others.map((m) => (
                      <td key={m.id} className="bda-numeric kit-mono">
                        {fmtMeasure(slice.measures[m.id] ?? null, m.format)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  )
  return (
    <section className="kit-section">
      <SectionHead title={`Ranking by ${dimensionLabel(spec, dim)}`} right={<MeasureSelect spec={spec} />} />
      <div className={showBottom ? 'kit-grid2' : ''}>
        {table(showBottom ? `Highest ${word(spec, measure.id)}` : `All ${ranked.length} by ${word(spec, measure.id)}`, top, top.slice(0, 10).map(rowDigest))}
        {showBottom ? table(`Lowest ${word(spec, measure.id)}`, bottom, bottom.slice(0, 10).map(rowDigest)) : null}
      </div>
    </section>
  )
}
