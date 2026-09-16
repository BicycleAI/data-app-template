import { armsOf } from '../../../../runtime/src/spec.js'
import { combinations } from '../../../../runtime/src/analysis.js'
import { fmtDate } from '../../../../runtime/src/format.js'
import { Card, type RecipeProps, trafficSplit } from '../../../../runtime/src/parts.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

export function Render({ spec, data }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  if (variant === undefined) return null
  const window = data.meta.window
  const combos = combinations(ui.dims, Math.min(ui.depth, ui.dims.length)).length
  const segments = data.segmentsAt(ui.dims, ui.depth).filter((segment) => segment.variant === variant.name).length
  return (
    <section className="kit-section">
      <div className="kit-sh">Experiment overview</div>
      <div className="kit-ovrow">
        <Card label="Test period" value={`${fmtDate(window.testStart)} — ${window.testEnd === undefined ? 'open' : fmtDate(window.testEnd)}`} small />
        <Card label="Test length" value={`${window.effectiveTld.toFixed(2)} days`} {...(window.scheduledTld === undefined ? {} : { hint: `${window.scheduledTld.toFixed(0)} scheduled` })} />
        <Card label="Traffic split" value={trafficSplit(data, armsOf(spec).control)} small />
        <Card label="Total participants" value={variant.participantsTotal.toLocaleString()} />
        <Card label="Combinations analyzed" value={combos.toLocaleString()} hint={`${ui.dims.length}C${Math.min(ui.depth, ui.dims.length)}`} />
        <Card label="Segments analyzed" value={segments.toLocaleString()} hint={spec.rules?.trim_quartile === false ? 'all segments' : 'thin quartile dropped'} />
      </div>
      <p className="bda-subtle kit-note">
        Segments are rolled up in the browser from the {spec.dimensions.length}-dimension pull: orders and net value are exact; bookers is a distinct count per leaf, so combined
        segments are an upper bound. Z-tests use experiment-level participant counts.
      </p>
    </section>
  )
}
