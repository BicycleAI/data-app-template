/**
 * Filter chips + time-range presets (T3.3). Renders nothing when the spec
 * declares neither a `filter` nor a `time` control — most specs still don't.
 *
 * A `filter` control narrows one declared dimension via the composer's fixed
 * parameter slots (see `compose/datasets.mjs`'s `## Filters`); this is the UI
 * that picks the values `controls.ts`'s `buildFilterParams` turns into those
 * parameters. `time` moves every query's `from`/`to`. Chips are the same
 * `.bda-pill` used elsewhere for a single choice (measure chips); a multi
 * filter adds an "All" chip and lets more than one stay pressed.
 */

import { buildFilterParams, seedOf, slotsOf, timePresets, useControls } from '../controls.js'
import { controlEnabled, dimensionLabel, filterControls, type Spec, type TimePreset } from '../spec.js'

const PRESET_LABEL: Record<TimePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  quarter: 'This quarter',
  ytd: 'Year to date',
}

/** "Region" -> "regions" — good enough for the dimension labels this narrows (short plain nouns). */
function plural(label: string): string {
  const lower = label.toLowerCase()
  return lower.endsWith('s') ? lower : `${lower}s`
}

export function FilterBar({ spec }: { spec: Spec }) {
  const { filters, time, toggleFilterValue, setFilterValue, resetFilter, setPreset } = useControls()
  const filterList = filterControls(spec)
  const hasTime = controlEnabled(spec, 'time')
  if (filterList.length === 0 && !hasTime) return null
  const { overflow } = buildFilterParams(spec, filters)

  return (
    <div className="kit-filterbar">
      {filterList.map((filterControl) => {
        const dim = filterControl.dim
        const label = dimensionLabel(spec, dim)
        const options = (filterControl.options ?? seedOf(filterControl)).map((value) => String(value))
        const selected = filters[dim] ?? options
        const multi = filterControl.multi === true
        const allSelected = multi && options.length > 0 && options.every((option) => selected.includes(option))
        return (
          <fieldset key={dim} className="bda-controls kit-filterbar__group">
            <legend className="bda-controls__label">{label}</legend>
            {multi ? (
              <button type="button" className="bda-pill" aria-pressed={allSelected} onClick={() => resetFilter(dim)}>
                All
              </button>
            ) : null}
            {options.map((option) => (
              <button
                key={option}
                type="button"
                className="bda-pill"
                aria-pressed={selected.includes(option)}
                onClick={() => (multi ? toggleFilterValue(dim, option) : setFilterValue(dim, option))}
              >
                {option}
              </button>
            ))}
            {overflow[dim] === true ? (
              <span className="bda-subtle kit-note kit-filterbar__note">
                Totals and trends show all {plural(label)} — pick up to {slotsOf(filterControl, seedOf(filterControl))} to narrow them.
              </span>
            ) : null}
          </fieldset>
        )
      })}
      {hasTime ? (
        <fieldset className="bda-controls kit-filterbar__group">
          <legend className="bda-controls__label">Time</legend>
          {timePresets(spec).map((preset) => (
            <button key={preset} type="button" className="bda-pill" aria-pressed={time.preset === preset} onClick={() => setPreset(preset)}>
              {PRESET_LABEL[preset]}
            </button>
          ))}
          <span className="bda-subtle kit-filterbar__range">
            {time.from} → {time.to}
          </span>
        </fieldset>
      ) : null}
    </div>
  )
}
