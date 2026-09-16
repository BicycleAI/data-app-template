/**
 * Viewer state shared by every recipe, plus the controls that change it.
 *
 * `measure` is the selected measure id (core) — for the ab_test family the
 * ids are the derived metrics NIBPD / NIBrPD / NICPD, mirrored in `metric`.
 */

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { VariantOverall } from './analysis.js'
import { control, controlEnabled, isAb, type Metric, METRICS, primaryMeasure, type Spec, word } from './spec.js'

export type UiState = {
  readonly measure: string
  readonly metric: Metric
  readonly depth: number
  readonly dims: readonly string[]
  readonly variantIndex: number
  readonly heatRows: string
  readonly heatCols: string
}

export type UiActions = {
  setMeasure(measure: string): void
  setMetric(metric: Metric): void
  setDepth(depth: number): void
  toggleDim(field: string): void
  setVariantIndex(index: number): void
  setHeatRows(field: string): void
  setHeatCols(field: string): void
}

const UiContext = createContext<(UiState & UiActions) | undefined>(undefined)

export function measureOptions(spec: Spec): string[] {
  const configured = control(spec, 'measure')?.options as string[] | undefined
  if (configured !== undefined && configured.length > 0) return configured
  return isAb(spec) ? [...METRICS] : spec.measures.map((measure) => measure.id)
}

export function UiProvider({ spec, children }: { spec: Spec; children: ReactNode }) {
  const depthControl = control(spec, 'depth')
  const options = measureOptions(spec)
  const initial = (control(spec, 'measure')?.default as string | undefined) ?? (isAb(spec) ? 'NIBPD' : primaryMeasure(spec).id)
  const [measure, setMeasureState] = useState<string>(options.includes(initial) ? initial : (options[0] ?? initial))
  const [depth, setDepth] = useState<number>(Number(depthControl?.default ?? 3))
  const [dims, setDims] = useState<readonly string[]>(spec.dimensions.map((dim) => dim.field))
  const [variantIndex, setVariantIndex] = useState(0)
  const [heatRows, setHeatRows] = useState(spec.dimensions[1]?.field ?? spec.dimensions[0]?.field ?? '')
  const [heatCols, setHeatCols] = useState(spec.dimensions[2]?.field ?? spec.dimensions[0]?.field ?? '')

  const value = useMemo(
    () => ({
      measure,
      metric: (METRICS as readonly string[]).includes(measure) ? (measure as Metric) : 'NIBPD',
      depth,
      dims,
      variantIndex,
      heatRows,
      heatCols,
      setMeasure: setMeasureState,
      setMetric: (metric: Metric) => setMeasureState(metric),
      setDepth,
      toggleDim: (field: string) => setDims((current) => (current.includes(field) ? current.filter((d) => d !== field) : [...current, field])),
      setVariantIndex,
      setHeatRows,
      setHeatCols,
    }),
    [measure, depth, dims, variantIndex, heatRows, heatCols],
  )
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function useUi(): UiState & UiActions {
  const value = useContext(UiContext)
  if (value === undefined) throw new Error('useUi outside UiProvider')
  return value
}

/** `overall` is `data.overall.rows ?? []` — undefined means "still pending", which the caller gates on separately. */
export function activeVariant(overall: readonly VariantOverall[], index: number): VariantOverall | undefined {
  return overall[Math.min(index, overall.length - 1)] ?? overall[0]
}

/** Pills for the selected measure. Works for core measure ids and ab_test derived metrics alike. */
export function MetricChips({ spec }: { spec: Spec }) {
  const ui = useUi()
  if (!controlEnabled(spec, 'measure')) return null
  const options = measureOptions(spec)
  if (options.length < 2) return null
  return (
    <fieldset className="bda-controls">
      <legend className="bda-visually-hidden">Measure</legend>
      {options.map((option) => (
        <button key={option} type="button" className="bda-pill" aria-pressed={option === ui.measure} onClick={() => ui.setMeasure(option)}>
          {word(spec, option)}
        </button>
      ))}
    </fieldset>
  )
}

export function MeasureSelect({ spec }: { spec: Spec }) {
  const ui = useUi()
  const options = measureOptions(spec)
  if (!controlEnabled(spec, 'measure') || options.length < 2) return null
  if (options.length <= 5) return <MetricChips spec={spec} />
  return (
    <label className="kit-field">
      <span>Measure</span>
      <select className="bda-select" value={ui.measure} onChange={(event) => ui.setMeasure(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {word(spec, option)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function DepthPills({ spec }: { spec: Spec }) {
  const ui = useUi()
  if (!controlEnabled(spec, 'depth')) return null
  const options = (control(spec, 'depth')?.options as number[] | undefined) ?? [1, 2, 3]
  return (
    <fieldset className="bda-controls">
      <legend className="bda-visually-hidden">Dimension combination depth</legend>
      <span className="bda-controls__label" aria-hidden="true">
        Combine
      </span>
      {options.map((option) => (
        <button key={option} type="button" className="bda-pill" aria-pressed={option === ui.depth} onClick={() => ui.setDepth(option)}>
          {option}-way
        </button>
      ))}
    </fieldset>
  )
}

export function DimensionChecks({ spec }: { spec: Spec }) {
  const ui = useUi()
  if (!controlEnabled(spec, 'dimensions') || spec.dimensions.length === 0) return null
  return (
    <fieldset className="bda-checkboxes bda-checkboxes--inline">
      <legend className="bda-visually-hidden">Dimensions</legend>
      <span className="bda-controls__label" aria-hidden="true">
        Dimensions
      </span>
      {spec.dimensions.map((dim) => (
        <label key={dim.field} className="bda-checkbox">
          <input type="checkbox" checked={ui.dims.includes(dim.field)} onChange={() => ui.toggleDim(dim.field)} />
          {dim.label}
        </label>
      ))}
    </fieldset>
  )
}

export function VariantSwitch({ spec, overall }: { spec: Spec; overall: readonly VariantOverall[] }) {
  const ui = useUi()
  if (overall.length <= 1 || !controlEnabled(spec, 'variant')) return null
  return (
    <div className="kit-seg" role="group" aria-label="Variant">
      {overall.map((option, index) => (
        <button key={option.name} type="button" className="kit-seg__btn" aria-pressed={index === ui.variantIndex} onClick={() => ui.setVariantIndex(index)}>
          {option.name}
        </button>
      ))}
    </div>
  )
}

export function HeatmapAxes({ spec }: { spec: Spec }) {
  const ui = useUi()
  if (!controlEnabled(spec, 'heatmap_axes') || spec.dimensions.length < 2) return null
  return (
    <div className="kit-axes">
      <label className="kit-field">
        <span>Rows</span>
        <select className="bda-select" value={ui.heatRows} onChange={(event) => ui.setHeatRows(event.target.value)}>
          {spec.dimensions.map((dim) => (
            <option key={dim.field} value={dim.field}>
              {dim.label}
            </option>
          ))}
        </select>
      </label>
      <label className="kit-field">
        <span>Columns</span>
        <select className="bda-select" value={ui.heatCols} onChange={(event) => ui.setHeatCols(event.target.value)}>
          {spec.dimensions.map((dim) => (
            <option key={dim.field} value={dim.field}>
              {dim.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
