import { fmtDelta, fmtMeasure, isGood, periodChange } from '../../runtime/src/core.js'
import { mergeQueries } from '../../runtime/src/data.js'
import { type CoreProps, Widget, widgetState } from '../../runtime/src/parts.js'
import { measureById, primaryMeasure, word } from '../../runtime/src/spec.js'

/**
 * One sentence about the primary measure: against its target when the spec
 * sets one, otherwise against the prior period. Waits on `totals` + `series`.
 */
export function Render({ spec, core, bind }: CoreProps) {
  const measure = (typeof bind.measure === 'string' ? measureById(spec, bind.measure) : undefined) ?? primaryMeasure(spec)
  const name = word(spec, measure.id)
  const query = mergeQueries(core.totals, core.series)
  const total = core.totals.rows?.[measure.id] ?? null
  const periods = spec.rules?.compare_periods ?? 7
  const series = core.series.rows ?? []
  const change = periodChange(measure, series, periods)
  const target = spec.rules?.targets?.[measure.id]
  const grain = spec.time.grain ?? 'day'

  let tone: 'positive' | 'negative' | 'warn' = 'warn'
  let headline = `${name}: ${fmtMeasure(total, measure.format, true)}`
  let body = 'Not enough history to compare periods yet.'

  if (target !== undefined && change.recent !== null) {
    const meets = (measure.good ?? 'up') === 'up' ? change.recent >= target : change.recent <= target
    tone = meets ? 'positive' : 'negative'
    headline = meets ? `${name} is on target` : `${name} is off target`
    body = `${fmtMeasure(change.recent, measure.format)} over the last ${change.periods} ${grain}s against a target of ${fmtMeasure(target, measure.format)}.`
  } else if (change.delta !== null) {
    const good = isGood(measure, change.delta)
    const moved = Math.abs(change.pct ?? 0) >= 0.02 || (measure.format === 'rate' && Math.abs(change.delta) >= 0.25)
    if (!moved || good === null) {
      tone = 'warn'
      headline = `${name} is steady`
      body = `${fmtDelta(change, measure.format)} over the last ${change.periods} ${grain}s versus the ${change.periods} before — within normal movement.`
    } else {
      tone = good ? 'positive' : 'negative'
      headline = good ? `${name} is improving` : `${name} is slipping`
      body = `${fmtDelta(change, measure.format)} over the last ${change.periods} ${grain}s versus the ${change.periods} before (${fmtMeasure(change.recent, measure.format, true)} vs ${fmtMeasure(change.previous, measure.format, true)}).`
    }
  }

  return (
    <Widget className={`kit-verdict kit-verdict--${tone}`} heading={<div className="kit-sh">Verdict</div>} skeleton={{ kind: 'text', lines: 2 }} {...widgetState(query)}>
      <div className="kit-verdict__head">
        <span className="kit-verdict__title">{headline}</span>
      </div>
      <p className="kit-verdict__body">{body}</p>
      <p className="kit-verdict__meta">
        {spec.time.from} → latest · {series.length} {grain}s of data
      </p>
    </Widget>
  )
}
