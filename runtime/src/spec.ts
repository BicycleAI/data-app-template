/**
 * The DataAppSpec v2 as the runtime sees it.
 *
 * A generic core (measures, dimensions, optional entity, time) plus an
 * optional analysis family. The composer prepends
 * `window.__DATA_APP_SPEC = {...}` to the prebuilt bundle.
 */

export type Metric = 'NIBPD' | 'NIBrPD' | 'NICPD'
export type MetricOrCvr = Metric | 'CVR'
export const METRICS: readonly Metric[] = ['NIBPD', 'NIBrPD', 'NICPD']

export type Persona = 'biz' | 'pm' | 'analyst' | 'exec'
export type TemplateId = 'scorecard' | 'report' | 'explorer' | 'brief'
export type Chrome = 'report' | 'explorer'
export type Grain = 'day' | 'week' | 'month'
export type Format = 'number' | 'currency' | 'percent' | 'rate'

export type MeasureSpec = {
  readonly id: string
  readonly column: string
  readonly label: string
  readonly format?: Format
  readonly good?: 'up' | 'down'
  readonly role?: 'primary' | 'secondary'
}

export type DimensionSpec = { readonly field: string; readonly label: string }

export type ControlKind = 'entity' | 'measure' | 'depth' | 'dimensions' | 'variant' | 'heatmap_axes' | 'grain' | 'filter' | 'time'
export type TimePreset = '7d' | '30d' | '90d' | 'quarter' | 'ytd'
export type ControlSpec = {
  readonly kind: ControlKind
  readonly options?: readonly unknown[]
  readonly default?: unknown
  /** `filter` only: the declared dimension this control narrows. */
  readonly dim?: string
  /** `filter` only: the viewer may pick several values. */
  readonly multi?: boolean
  /**
   * `filter` only: how many values may be narrowed to at once. The composer
   * declares one `<slug>_<i>` query parameter per slot; spare slots repeat the
   * last picked value, and picking more than this many leaves the aggregate
   * queries unnarrowed. Defaults to `min(options.length, 5)`.
   */
  readonly slots?: number
  /** `time` only: the ranges offered. */
  readonly presets?: readonly TimePreset[]
}

/** A `filter` control, narrowed to the shape the FilterBar needs. */
export type FilterControl = ControlSpec & { readonly kind: 'filter'; readonly dim: string }

export type Panel = {
  readonly recipe: string
  readonly bind?: Readonly<Record<string, unknown>>
  readonly say?: string
  readonly width?: 'full' | 'half' | 'third'
}

export type EntitySpec = {
  readonly field: string
  readonly label: string
  readonly type?: 'number' | 'string'
  readonly list?: {
    readonly label?: string
    readonly description?: string
    readonly status?: string
    readonly group?: string
    readonly end?: string
    readonly rank: string
  }
}

export type AbFamily = {
  readonly kind: 'ab_test'
  readonly arms: { readonly field: string; readonly control: string; readonly exclude?: readonly string[] }
  readonly roles: {
    readonly bookers: string
    readonly orders: string
    readonly value: string
    readonly participants: { readonly arm: string; readonly control: string; readonly total: string }
  }
  readonly context?: {
    readonly description?: string
    readonly tag?: string
    readonly status?: string
    readonly start?: string
    readonly end?: string
    readonly as_of?: string
    readonly group?: string
  }
}

export type Family = AbFamily

export type Rules = {
  readonly confidence_bar?: '80%' | '90%' | '95%' | '99%'
  readonly min_bookers?: number
  readonly trim_quartile?: boolean
  readonly compare_periods?: number
  readonly targets?: Readonly<Record<string, number>>
  /** A declared blob holding targets; overrides `targets` when present. */
  readonly targets_blob?: string
}

/** Persistence the app may use, brokered by the host and scoped to this app. */
export type StoreSpec = {
  readonly cache?: { readonly ttl_seconds?: number; readonly max_value_bytes?: number; readonly writable_by?: 'viewer' | 'builder' }
  readonly blobs?: readonly { readonly name: string; readonly purpose: string; readonly kind?: 'json' | 'csv' | 'binary'; readonly max_bytes?: number }[]
}

export type Spec = {
  readonly version: 2
  readonly appId?: string
  readonly model: string
  readonly title: string
  readonly decision?: string
  readonly persona: Persona
  readonly template: TemplateId
  readonly chrome?: Chrome
  readonly time: { readonly column?: string; readonly from: string; readonly to: string; readonly grain?: Grain }
  readonly entity?: EntitySpec
  readonly measures: readonly MeasureSpec[]
  readonly dimensions: readonly DimensionSpec[]
  readonly family?: Family
  readonly questions: readonly { readonly say: string; readonly recipe: string; readonly bind?: Record<string, unknown> }[]
  readonly controls?: readonly ControlSpec[]
  readonly words?: Readonly<Record<string, string>>
  readonly rules?: Rules
  readonly theme?: { readonly accent?: 'blue' | 'teal' | 'purple' | 'amber' | 'coral'; readonly follow?: 'system' | 'light' | 'dark' }
  readonly store?: StoreSpec
  readonly panels?: readonly Panel[]
  /**
   * Whether the host page offers its chat for this app, and what it may
   * anchor to. Read by the host, not by the runtime: the runtime reports
   * panel context and selection unconditionally (see `studio/contextRegistry.ts`)
   * and never renders a chat UI itself — invariant 9, "the chat UI is
   * host-owned".
   */
  readonly chat?: { readonly enabled: boolean; readonly anchors?: readonly ('panel' | 'selection' | 'none')[] }
}

declare global {
  interface Window {
    __DATA_APP_SPEC?: Spec
  }
}

/** Query ids the composer declares. The runtime never invents others. */
export const QUERY = {
  entityList: 'entity_list',
  totals: 'totals',
  byTime: 'by_time',
  byDimension: 'by_dimension',
  byTimeDim: (field: string) => `by_time_${field.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
  // ab_test family
  meta: 'experiment_meta',
  armTotals: 'arm_totals',
  segments: 'segments',
  trend: 'daily_trend',
} as const

export function loadSpec(): Spec {
  const injected = window.__DATA_APP_SPEC
  if (injected !== undefined) return injected
  throw new Error('No spec was injected into this bundle. Compose the app with `kit compose <spec.json>`.')
}

/** Display name for a measure id or derived metric id, from the interview's words or the spec's label. */
export function word(spec: Spec, id: string): string {
  return spec.words?.[id] ?? spec.measures.find((measure) => measure.id === id)?.label ?? id
}

export function measureById(spec: Spec, id: string): MeasureSpec | undefined {
  return spec.measures.find((measure) => measure.id === id)
}

export function primaryMeasure(spec: Spec): MeasureSpec {
  const primary = spec.measures.find((measure) => measure.role === 'primary') ?? spec.measures[0]
  if (primary === undefined) throw new Error('spec has no measures')
  return primary
}

export function dimensionLabel(spec: Spec, field: string): string {
  return spec.dimensions.find((dim) => dim.field === field)?.label ?? field
}

export function controlEnabled(spec: Spec, kind: ControlKind): boolean {
  return (spec.controls ?? []).some((control) => control.kind === kind)
}

export function control(spec: Spec, kind: ControlKind): ControlSpec | undefined {
  return (spec.controls ?? []).find((control) => control.kind === kind)
}

/**
 * The declared filter controls, in spec order.
 *
 * The datasets that aggregate the dimension away carry one `<slug>_<i>` string
 * parameter per slot (see compose/datasets.mjs `## Filters`); binding the
 * viewer's pick to those parameters, padding the spare slots and saying so when
 * the pick is wider than the slots, is the FilterBar's job (T3.3). Nothing
 * renders these yet.
 */
export function filterControls(spec: Spec): readonly FilterControl[] {
  return (spec.controls ?? []).filter((control): control is FilterControl => control.kind === 'filter' && typeof control.dim === 'string')
}

export function resolveTo(to: string): string {
  if (to !== 'tomorrow') return to
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}

export function isAb(spec: Spec): spec is Spec & { family: AbFamily } {
  return spec.family?.kind === 'ab_test'
}

export function armsOf(spec: Spec): AbFamily['arms'] {
  return isAb(spec) ? spec.family.arms : { field: '', control: 'DEFAULT' }
}

/**
 * The flat binding the A/B maths works on: role -> metric column. Built once
 * per spec so analysis.ts never has to know about measure ids.
 */
export type AbSpec = {
  readonly measures: {
    readonly bookers: string
    readonly orders: string
    readonly value: string
    readonly participants: { readonly arm: string; readonly control: string; readonly total: string }
  }
  readonly arms: AbFamily['arms']
  readonly context: NonNullable<AbFamily['context']>
  readonly dimensions: readonly DimensionSpec[]
  readonly rules: Rules
}

export function toAbSpec(spec: Spec & { family: AbFamily }): AbSpec {
  const column = (id: string) => {
    const measure = measureById(spec, id)
    if (measure === undefined) throw new Error(`family role points at unknown measure "${id}"`)
    return measure.column
  }
  const roles = spec.family.roles
  return {
    measures: {
      bookers: column(roles.bookers),
      orders: column(roles.orders),
      value: column(roles.value),
      participants: { arm: column(roles.participants.arm), control: column(roles.participants.control), total: column(roles.participants.total) },
    },
    arms: spec.family.arms,
    context: spec.family.context ?? {},
    dimensions: spec.dimensions,
    rules: spec.rules ?? {},
  }
}
