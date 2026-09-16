import { useMemo } from 'react'
import type { Segment } from '../../../../runtime/src/analysis.js'
import { fmtInt, fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, type RecipeProps, SectionHead } from '../../../../runtime/src/parts.js'
import { type Metric } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const count = typeof bind.count === 'number' ? bind.count : 6
  const segments = useMemo(() => (variant === undefined ? [] : data.segmentsAt(ui.dims, 2).filter((segment) => segment.variant === variant.name)), [data, ui.dims, variant])
  const up = segments.filter((segment) => segment[metric] > 0).sort((a, b) => b[metric] - a[metric]).slice(0, count)
  const down = segments.filter((segment) => segment[metric] < 0).sort((a, b) => a[metric] - b[metric]).slice(0, count)
  const max = Math.max(...[...up, ...down].map((segment) => Math.abs(segment[metric])), 1)
  const column = (title: string, rows: readonly Segment[], tone: 'positive' | 'negative') => (
    <div className="bda-card kit-panel">
      <div className="kit-dim__head">
        <span className="kit-dim__title" style={{ color: `var(--bda-${tone})` }}>
          {title}
        </span>
      </div>
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
    </div>
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
