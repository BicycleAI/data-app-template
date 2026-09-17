import { useMemo } from 'react'
import { type Segment, topDraggers, topLifters } from '../../../../runtime/src/analysis.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtInt } from '../../../../runtime/src/format.js'
import { Badge, type RecipeProps, Signed, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { armsOf, type Spec, word } from '../../../../runtime/src/spec.js'
import { activeVariant, MetricChips, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const depth = typeof bind.depth === 'number' ? bind.depth : ui.depth
  const count = typeof bind.count === 'number' ? bind.count : 10
  const segQuery = data.segmentsAt(ui.dims, depth)
  const query = mergeQueries(data.overall, segQuery)
  const segments = useMemo(
    () => (variant === undefined ? [] : (segQuery.rows ?? []).filter((segment) => segment.variant === variant.name)),
    [segQuery.rows, variant],
  )
  return (
    <section className="kit-section">
      <div className="kit-sh">Deep-dive analysis</div>
      <Table spec={spec} title="Top Lifters" tone="positive" rows={topLifters(segments, ui.metric, count)} query={query} count={count} />
      <Table spec={spec} title="Top Draggers" tone="negative" rows={topDraggers(segments, ui.metric, count)} query={query} count={count} />
    </section>
  )
}

function Table({ spec, title, tone, rows, query, count }: { spec: Spec; title: string; tone: 'positive' | 'negative'; rows: readonly Segment[]; query: ReturnType<typeof mergeQueries>; count: number }) {
  const ui = useUi()
  return (
    <Widget
      className={`bda-card kit-tcard kit-tcard--${tone}`}
      heading={
        <div className="kit-tcard__head">
          <span>
            {tone === 'positive' ? '↑' : '↓'} {title}
          </span>
          <MetricChips spec={spec} />
        </div>
      }
      skeleton={{ kind: 'table', rows: count }}
      {...widgetState(query)}
    >
      {rows.length === 0 ? (
        <div className="bda-state">
          No segments {tone === 'positive' ? 'above' : 'below'} zero on {word(spec, ui.metric)}.
        </div>
      ) : (
        <div className="kit-scroll">
          <table className="bda-table kit-table">
            <thead>
              <tr>
                <th>Segment</th>
                <th className="bda-numeric">Bookers ({armsOf(spec).control.slice(0, 1)})</th>
                <th className="bda-numeric">Bookers (V)</th>
                <th className="bda-numeric">{word(spec, 'NIBPD')}</th>
                <th className="bda-numeric">{word(spec, 'NIBrPD')}</th>
                <th className="bda-numeric">{word(spec, 'NICPD')}</th>
                <th>Z-test sig</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.dims.join('|')}#${row.values.join('|')}`}>
                  <td className="kit-desc">{row.label}</td>
                  <td className="bda-numeric kit-mono">{fmtInt(row.bookersDefault)}</td>
                  <td className="bda-numeric kit-mono">{fmtInt(row.bookersVariant)}</td>
                  <td className="bda-numeric kit-mono">
                    <Signed value={row.NIBPD} />
                  </td>
                  <td className="bda-numeric kit-mono">
                    <Signed value={row.NIBrPD} />
                  </td>
                  <td className="bda-numeric kit-mono">
                    <Signed value={row.NICPD} currency />
                  </td>
                  <td>
                    <Badge confidence={row.confidence} z={row.z} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  )
}
