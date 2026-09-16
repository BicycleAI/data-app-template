import { useMemo } from 'react'
import { buildInsights } from '../../../../runtime/src/analysis.js'
import { type RecipeProps, SectionHead } from '../../../../runtime/src/parts.js'
import { dimensionLabel, type Metric } from '../../../../runtime/src/spec.js'
import { activeVariant, MetricChips, useUi } from '../../../../runtime/src/ui.js'

export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const segments = useMemo(
    () => (variant === undefined ? [] : data.segmentsAt(ui.dims, ui.depth).filter((segment) => segment.variant === variant.name)),
    [data, ui.dims, ui.depth, variant],
  )
  const insights = useMemo(
    () => buildInsights(segments, metric, data.meta.description, spec.words ?? {}, (field) => dimensionLabel(spec, field)),
    [segments, metric, data.meta.description, spec],
  )
  return (
    <section className="kit-section">
      <SectionHead title="Key insights" right={<MetricChips spec={spec} />} />
      {segments.length === 0 ? (
        <div className="bda-state">No paired segments at this combination depth.</div>
      ) : (
        <div className="kit-grid2">
          <div className="bda-card kit-icard kit-icard--positive">
            <div className="kit-ihead">
              <span style={{ color: 'var(--bda-positive)' }}>{'↑'}</span> What&apos;s working
            </div>
            <ul>
              {insights.working.map((insight, index) => (
                // biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally with every value escaped
                <li key={index} dangerouslySetInnerHTML={{ __html: insight.html }} />
              ))}
            </ul>
          </div>
          <div className="bda-card kit-icard kit-icard--negative">
            <div className="kit-ihead">
              <span style={{ color: 'var(--bda-negative)' }}>{'↓'}</span> What needs attention
            </div>
            <ul>
              {insights.attention.map((insight, index) => (
                // biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally with every value escaped
                <li key={index} dangerouslySetInnerHTML={{ __html: insight.html }} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
