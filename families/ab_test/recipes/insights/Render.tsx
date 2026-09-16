import { useMemo } from 'react'
import { buildInsights } from '../../../../runtime/src/analysis.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { type RecipeProps, SectionHead, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { dimensionLabel, type Metric } from '../../../../runtime/src/spec.js'
import { activeVariant, MetricChips, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.meta` + `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const segQuery = data.segmentsAt(ui.dims, ui.depth)
  const query = mergeQueries(data.meta, data.overall, segQuery)
  const segments = useMemo(
    () => (variant === undefined ? [] : (segQuery.rows ?? []).filter((segment) => segment.variant === variant.name)),
    [segQuery.rows, variant],
  )
  const insights = useMemo(
    () => buildInsights(segments, metric, data.meta.rows?.description ?? '', spec.words ?? {}, (field) => dimensionLabel(spec, field)),
    [segments, metric, data.meta.rows, spec],
  )
  return (
    <section className="kit-section">
      <SectionHead title="Key insights" right={<MetricChips spec={spec} />} />
      <Widget className="bda-card" heading={null} skeleton={{ kind: 'text', lines: 4 }} {...widgetState(query)}>
        {segments.length === 0 ? (
          <div className="bda-state">No paired segments at this combination depth.</div>
        ) : (
          <div className="kit-grid2">
            <div className="kit-icard kit-icard--positive">
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
            <div className="kit-icard kit-icard--negative">
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
      </Widget>
    </section>
  )
}
