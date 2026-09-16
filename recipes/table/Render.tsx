import { useMemo, useState } from 'react'
import { fmtMeasure } from '../../runtime/src/core.js'
import { type CoreProps, SectionHead, Widget, widgetState } from '../../runtime/src/parts.js'
import { dimensionLabel, primaryMeasure, word } from '../../runtime/src/spec.js'
import { useUi } from '../../runtime/src/ui.js'

/** Every measure for every combination of the selected dimensions; click a header to sort. Waits on `core.dims`. */
export function Render({ spec, core, bind }: CoreProps) {
  const ui = useUi()
  const dims = Array.isArray(bind.dims) ? (bind.dims as string[]) : ui.dims.slice(0, 3)
  const limit = typeof bind.limit === 'number' ? bind.limit : 25
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: primaryMeasure(spec).id, dir: 'desc' })
  const rows = useMemo(() => {
    const slices = dims.length === 0 ? [] : core.slicesAt(dims)
    return [...slices].sort((a, b) => ((b.measures[sort.id] ?? -Infinity) - (a.measures[sort.id] ?? -Infinity)) * (sort.dir === 'desc' ? 1 : -1)).slice(0, limit)
  }, [core, dims, sort, limit])
  if (dims.length === 0) return null
  const toggle = (id: string) => setSort((previous) => (previous.id === id ? { id, dir: previous.dir === 'desc' ? 'asc' : 'desc' } : { id, dir: 'desc' }))
  return (
    <section className="kit-section">
      <SectionHead title="Table" right={<span className="bda-subtle">{dims.map((dim) => dimensionLabel(spec, dim)).join(' × ')} · top {rows.length}</span>} />
      <Widget className="bda-card kit-tcard" heading={null} skeleton={{ kind: 'table', rows: Math.min(limit, 10) }} {...widgetState(core.dims)}>
        <div className="kit-scroll">
          <table className="bda-table kit-table">
            <thead>
              <tr>
                {dims.map((dim) => (
                  <th key={dim}>{dimensionLabel(spec, dim)}</th>
                ))}
                {spec.measures.map((measure) => (
                  <th key={measure.id} className="bda-numeric kit-sortable" aria-sort={sort.id === measure.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => toggle(measure.id)}>
                    {word(spec, measure.id)}
                    {sort.id === measure.id ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((slice) => (
                <tr key={slice.key}>
                  {slice.values.map((value, index) => (
                    <td key={index}>{value}</td>
                  ))}
                  {spec.measures.map((measure) => (
                    <td key={measure.id} className="bda-numeric kit-mono">
                      {fmtMeasure(slice.measures[measure.id] ?? null, measure.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Widget>
    </section>
  )
}
