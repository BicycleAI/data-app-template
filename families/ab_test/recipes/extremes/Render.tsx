import type { Segment } from '../../../../runtime/src/analysis.js'
import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtInt, fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, type RecipeProps, SectionHead, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, type Metric, QUERY } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const count = typeof bind.count === 'number' ? bind.count : 6
  const segQuery = data.segmentsAt(ui.dims, 2)
  const query = mergeQueries(data.overall, segQuery)
  const segments = variant === undefined ? [] : (segQuery.rows ?? []).filter((segment) => segment.variant === variant.name)
  const up = segments.filter((segment) => segment[metric] > 0).sort((a, b) => b[metric] - a[metric]).slice(0, count)
  const down = segments.filter((segment) => segment[metric] < 0).sort((a, b) => a[metric] - b[metric]).slice(0, count)
  const max = Math.max(...[...up, ...down].map((segment) => Math.abs(segment[metric])), 1)
  const column = (title: string, rows: readonly Segment[], tone: 'positive' | 'negative') => (
    <Widget
      className="bda-card kit-panel"
      heading={
        <div className="kit-dim__head">
          <span className="kit-dim__title" style={{ color: `var(--bda-${tone})` }}>
            {title}
          </span>
        </div>
      }
      skeleton={{ kind: 'table', rows: count }}
      spec={spec}
      provenance={provenanceSpec({ queries: [QUERY.armTotals, QUERY.segments], measures: abRoleMeasureIds(spec), rowCount: rows.length || undefined })}
      {...widgetState(query)}
    >
      {rows.length === 0 ? (
        <div className="bda-state">None.</div>
      ) : (
        <ul className="kit-ranks">
          {rows.map((segment) => (
            <li key={segment.label}>
              <div className="kit-rank__row">
                <span className="kit-rank__label">{segment.label}</span>
                <span className="kit-mono" style={{ color: `var(--bda-${tone})` }}>
                  {fmtSigned(segment[metric], metric === 'NICPD')}
                </span>
              </div>
              <div className="kit-rank__meta">
                <span className="kit-rank__bar" style={{ width: `${(Math.abs(segment[metric]) / max) * 100}%`, background: `var(--bda-${tone})` }} />
                <span className="bda-subtle">{fmtInt(segment.bookersVariant)} bookers</span>
                <Badge confidence={segment.confidence} z={segment.z} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
  return (
    <section className="kit-section">
      <SectionHead title="Extremes" right={<span className="bda-subtle">two-dimension segments · {spec.rules?.trim_quartile === false ? 'all' : 'thin quartile dropped'}</span>} />
      <div className="kit-grid2">
        {column('Strongest lift', up, 'positive')}
        {column('Strongest drag', down, 'negative')}
      </div>
    </section>
  )
}
