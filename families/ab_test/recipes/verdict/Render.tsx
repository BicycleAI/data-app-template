import { meetsBar } from '../../../../runtime/src/analysis.js'
import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, type RecipeProps, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, armsOf, type Metric, QUERY, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** One sentence: winning, losing, or not yet decidable against the spec's confidence bar. Waits on `data.meta` + `data.overall`. */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const query = mergeQueries(data.meta, data.overall)
  if (!query.isPending && variant === undefined) return null
  const metric = (typeof bind.measure === 'string' && bind.measure !== 'ui' ? (bind.measure as Metric) : ui.metric) ?? 'NIBPD'
  const value = variant?.kpis[metric] ?? null
  const bar = spec.rules?.confidence_bar ?? '90%'
  const confident = variant !== undefined && meetsBar(variant.kpis.confidence, bar)
  const positive = value !== null && value > 0

  let tone: 'positive' | 'negative' | 'warn' = 'warn'
  let headline = 'Not enough evidence yet'
  let body = variant === undefined ? '' : `${variant.name} shows ${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control}, below your ${bar} confidence bar. Keep running.`
  if (variant !== undefined && value !== null && confident && positive) {
    tone = 'positive'
    headline = `${variant.name} is winning`
    body = `${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control} at ${variant.kpis.confidence} confidence, clearing your ${bar} bar.`
  } else if (variant !== undefined && value !== null && confident && !positive) {
    tone = 'negative'
    headline = `${variant.name} is behind`
    body = `${fmtSigned(value, metric === 'NICPD', false)} ${word(spec, metric).toLowerCase()} versus ${armsOf(spec).control} at ${variant.kpis.confidence} confidence. The change is costing you; consider stopping.`
  }

  const meta = data.meta.rows
  const provenance = provenanceSpec({ queries: [QUERY.meta, QUERY.armTotals], measures: abRoleMeasureIds(spec), rowCount: overall.length || undefined, asOf: meta?.window.dataAsOf })
  return (
    <Widget className={`kit-verdict kit-verdict--${tone}`} heading={<div className="kit-sh">Verdict</div>} skeleton={{ kind: 'text', lines: 2 }} spec={spec} provenance={provenance} {...widgetState(query)}>
      <div className="kit-verdict__head">
        <span className="kit-verdict__title">{headline}</span>
        {variant === undefined ? null : <Badge confidence={variant.kpis.confidence} z={variant.kpis.z} />}
      </div>
      <p className="kit-verdict__body">{body}</p>
      <p className="kit-verdict__meta">
        {(meta?.tag || meta?.entityId) ?? '—'} · data as of {meta?.window.dataAsOf ?? '—'} · {meta === undefined ? '—' : meta.window.effectiveTld.toFixed(1)} days
      </p>
    </Widget>
  )
}
