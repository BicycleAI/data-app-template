import { combinations } from '../../../../runtime/src/analysis.js'
import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtDate } from '../../../../runtime/src/format.js'
import { Card, type RecipeProps, trafficSplit, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, armsOf, QUERY } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/** Waits on `data.meta` + `data.overall` + `data.segmentsAt`. */
export function Render({ spec, data }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const segQuery = data.segmentsAt(ui.dims, ui.depth)
  const query = mergeQueries(data.meta, data.overall, segQuery)
  if (!query.isPending && variant === undefined) return null
  const window = data.meta.rows?.window
  const combos = combinations(ui.dims, Math.min(ui.depth, ui.dims.length)).length
  const segments = (segQuery.rows ?? []).filter((segment) => segment.variant === variant?.name).length
  return (
    <section className="kit-section">
      <div className="kit-sh">Experiment overview</div>
      <Widget
        className="bda-card"
        heading={null}
        skeleton={{ kind: 'metric' }}
        spec={spec}
        provenance={provenanceSpec({ queries: [QUERY.meta, QUERY.armTotals, QUERY.segments], measures: abRoleMeasureIds(spec), rowCount: segments || undefined, asOf: window?.dataAsOf })}
        {...widgetState(query)}
      >
        <div className="kit-ovrow">
          <Card label="Test period" value={window === undefined ? '—' : `${fmtDate(window.testStart)} — ${window.testEnd === undefined ? 'open' : fmtDate(window.testEnd)}`} small />
          <Card label="Test length" value={window === undefined ? '—' : `${window.effectiveTld.toFixed(2)} days`} {...(window?.scheduledTld === undefined ? {} : { hint: `${window.scheduledTld.toFixed(0)} scheduled` })} />
          <Card label="Traffic split" value={trafficSplit(overall, armsOf(spec).control)} small />
          <Card label="Total participants" value={(variant?.participantsTotal ?? 0).toLocaleString()} />
          <Card label="Combinations analyzed" value={combos.toLocaleString()} hint={`${ui.dims.length}C${Math.min(ui.depth, ui.dims.length)}`} />
          <Card label="Segments analyzed" value={segments.toLocaleString()} hint={spec.rules?.trim_quartile === false ? 'all segments' : 'thin quartile dropped'} />
        </div>
        <p className="bda-subtle kit-note">
          Segments are rolled up in the browser from the {spec.dimensions.length}-dimension pull: orders and net value are exact; bookers is a distinct count per leaf, so combined
          segments are an upper bound. Z-tests use experiment-level participant counts.
        </p>
      </Widget>
    </section>
  )
}
