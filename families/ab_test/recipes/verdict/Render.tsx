import { meetsBar } from '../../../../runtime/src/analysis.js'
import { fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, type RecipeProps } from '../../../../runtime/src/parts.js'
import { armsOf, type Metric, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** One sentence: winning, losing, or not yet decidable against the spec's confidence bar. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  if (variant === undefined) return null
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const value = variant.kpis[metric]
  const bar = spec.rules?.confidence_bar ?? '90%'
  const confident = meetsBar(variant.kpis.confidence, bar)
  const positive = value !== null && value > 0

  let tone: 'positive' | 'negative' | 'warn' = 'warn'
  let headline = 'Not enough evidence yet'
  let body = `${variant.name} shows ${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control}, below your ${bar} confidence bar. Keep running.`
  if (value !== null && confident && positive) {
    tone = 'positive'
    headline = `${variant.name} is winning`
    body = `${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control} at ${variant.kpis.confidence} confidence, clearing your ${bar} bar.`
  } else if (value !== null && confident && !positive) {
    tone = 'negative'
    headline = `${variant.name} is behind`
    body = `${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control} at ${variant.kpis.confidence} confidence. The change is costing you; consider stopping.`
  }

  return (
    <section className={`kit-verdict kit-verdict--${tone}`}>
      <div className="kit-verdict__head">
        <span className="kit-verdict__title">{headline}</span>
        <Badge confidence={variant.kpis.confidence} z={variant.kpis.z} />
      </div>
      <p className="kit-verdict__body">{body}</p>
      <p className="kit-verdict__meta">
        {data.meta.tag || data.meta.entityId} · data as of {data.meta.window.dataAsOf} · {data.meta.window.effectiveTld.toFixed(1)} days
      </p>
    </section>
  )
}
