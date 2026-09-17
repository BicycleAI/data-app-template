import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import type { TrendPoint, VariantOverall } from '../../../../runtime/src/analysis.js'
import { provenanceSpec, type ProvenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { Chart } from '../../../../runtime/src/components/Chart.js'
import { mergeQueries } from '../../../../runtime/src/data.js'
import { fmtPct, fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, Card, METRIC_COLOR, METRIC_TITLE, type RecipeProps, statusTone, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { abRoleMeasureIds, armsOf, controlEnabled, type Metric, METRICS, QUERY, type Spec, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/**
 * Two styles. `row` is the report's compact overview strip (id, product,
 * status, variant, KPIs, CVR). `spark` is the explorer's tiles with a
 * sparkline under each number. Waits on `data.meta` + `data.overall` (row and
 * spark) and additionally `data.trend` (spark, for the sparkline).
 */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const overall = data.overall.rows ?? []
  const variant = activeVariant(overall, ui.variantIndex)
  const style = bind.style === 'spark' ? 'spark' : 'row'

  if (style === 'spark') {
    const query = mergeQueries(data.meta, data.overall, data.trend)
    if (!query.isPending && variant === undefined) return null
    const trend = data.trend.rows?.filter((point) => point.variant === variant?.name) ?? []
    const provenance = provenanceSpec({ queries: [QUERY.meta, QUERY.armTotals, QUERY.trend], measures: abRoleMeasureIds(spec), rowCount: trend.length || undefined, asOf: data.meta.rows?.window.dataAsOf })
    return (
      <section className="kit-kpis">
        {METRICS.map((metric) => (
          <SparkTile key={metric} spec={spec} metric={metric} variant={variant} trend={trend} active={metric === ui.metric && controlEnabled(spec, 'measure')} query={query} provenance={provenance} />
        ))}
        <CvrSparkTile spec={spec} variant={variant} trend={trend} query={query} provenance={provenance} />
      </section>
    )
  }

  const query = mergeQueries(data.meta, data.overall)
  if (!query.isPending && variant === undefined) return null
  const meta = data.meta.rows
  const next = variant === undefined ? 0 : (ui.variantIndex + 1) % overall.length
  const provenance = provenanceSpec({ queries: [QUERY.meta, QUERY.armTotals], measures: abRoleMeasureIds(spec), rowCount: overall.length || undefined, asOf: meta?.window.dataAsOf })
  return (
    <section className="kit-section">
      <div className="kit-sh">Overview</div>
      <Widget className="kit-ovrow" heading={null} skeleton={{ kind: 'metric' }} spec={spec} provenance={provenance} {...widgetState(query)}>
        <Card label={spec.entity?.label ?? 'Entity'} value={meta?.entityId ?? '—'} {...(meta !== undefined && meta.tag.length > 0 ? { hint: meta.tag } : {})} />
        {meta !== undefined && meta.group.length > 0 ? <Card label="Primary product" value={meta.group} /> : null}
        <Card label="Status" value={meta?.status || 'Unknown'} tone={statusTone(meta?.status ?? '')} />
        {overall.length > 1 && controlEnabled(spec, 'variant') && variant !== undefined ? (
          <button type="button" className="kit-card kit-card--button" onClick={() => ui.setVariantIndex(next)}>
            <span className="kit-card__label">Variant</span>
            <span className="kit-card__value" style={{ color: `var(--bda-chart-${(ui.variantIndex % 4) + 1})` }}>
              {variant.name}
            </span>
            <span className="kit-card__hint">
              {'→'} {overall[next]?.name}
            </span>
          </button>
        ) : (
          <Card label="Variant" value={variant?.name ?? '—'} tone="accent" />
        )}
        {METRICS.map((metric) => {
          const value = variant?.kpis[metric] ?? null
          return <Card key={metric} label={word(spec, metric)} value={fmtSigned(value, metric === 'NICPD')} {...(value === null ? {} : { tone: value >= 0 ? 'positive' : 'negative' })} />
        })}
        <Card
          label={word(spec, 'CVR')}
          value={variant?.kpis.cvrVariant == null ? '—' : fmtPct(variant.kpis.cvrVariant)}
          {...(variant?.kpis.cvrDefault == null ? {} : { hint: `vs ${fmtPct(variant.kpis.cvrDefault)} (${armsOf(spec).control})` })}
          tone="cvr"
        />
        <Card label="Data as of" value={meta?.window.dataAsOf ?? '—'} {...(variant === undefined ? {} : { hint: <Badge confidence={variant.kpis.confidence} z={variant.kpis.z} /> })} small />
      </Widget>
    </section>
  )
}

const SPARK = { marginLeft: 4, marginRight: 4, marginTop: 4, marginBottom: 4, x: { axis: null }, y: { axis: null, grid: false } }

function SparkTile({
  spec,
  metric,
  variant,
  trend,
  active,
  query,
  provenance,
}: {
  spec: Spec
  metric: Metric
  variant: VariantOverall | undefined
  trend: readonly TrendPoint[]
  active: boolean
  query: ReturnType<typeof mergeQueries>
  provenance: ProvenanceSpec
}) {
  const value = variant?.kpis[metric] ?? null
  const series = useMemo(() => trend.flatMap((point) => (point[metric] === null ? [] : [{ day: point.day, value: point[metric] as number }])), [trend, metric])
  const options = useMemo(
    () => ({
      ...SPARK,
      marks: [
        Plot.ruleY([0], { stroke: 'var(--bda-border)' }),
        Plot.areaY(series, { x: 'day', y: 'value', fill: METRIC_COLOR[metric], fillOpacity: 0.12 }),
        Plot.lineY(series, { x: 'day', y: 'value', stroke: METRIC_COLOR[metric], strokeWidth: 2 }),
      ],
    }),
    [series, metric],
  )
  return (
    <Widget
      className={`bda-card kit-kpi${active ? ' kit-kpi--active' : ''}`}
      style={{ borderTopColor: METRIC_COLOR[metric] }}
      heading={<div className="kit-kpi__label">{word(spec, metric)}</div>}
      skeleton={{ kind: 'metric' }}
      spec={spec}
      provenance={provenance}
      {...widgetState(query)}
    >
      <div className="kit-kpi__value" style={{ color: value === null ? undefined : value >= 0 ? 'var(--bda-positive)' : 'var(--bda-negative)' }}>
        {fmtSigned(value, metric === 'NICPD')}
      </div>
      <div className="kit-kpi__sub">{METRIC_TITLE[metric]}</div>
      {series.length > 1 ? <Chart options={options} height={56} title={`${metric} trend`} className="kit-spark" /> : null}
    </Widget>
  )
}

function CvrSparkTile({
  spec,
  variant,
  trend,
  query,
  provenance,
}: {
  spec: Spec
  variant: VariantOverall | undefined
  trend: readonly TrendPoint[]
  query: ReturnType<typeof mergeQueries>
  provenance: ProvenanceSpec
}) {
  const series = useMemo(
    () =>
      trend.flatMap((point) => [
        ...(point.cvr === null ? [] : [{ day: point.day, value: point.cvr, series: 'variant' }]),
        ...(point.cvrDefault === null ? [] : [{ day: point.day, value: point.cvrDefault, series: 'default' }]),
      ]),
    [trend],
  )
  const options = useMemo(
    () => ({
      ...SPARK,
      marks: [
        Plot.lineY(series.filter((d) => d.series === 'default'), { x: 'day', y: 'value', stroke: 'var(--bda-text-secondary)', strokeWidth: 1.5, strokeDasharray: '4,3' }),
        Plot.lineY(series.filter((d) => d.series === 'variant'), { x: 'day', y: 'value', stroke: METRIC_COLOR.CVR, strokeWidth: 2 }),
      ],
    }),
    [series],
  )
  const kpis = variant?.kpis
  const cvrVariant = kpis?.cvrVariant ?? null
  const cvrDefault = kpis?.cvrDefault ?? null
  const delta = cvrVariant === null || cvrDefault === null ? null : (cvrVariant - cvrDefault) * 10_000
  return (
    <Widget
      className="bda-card kit-kpi"
      style={{ borderTopColor: METRIC_COLOR.CVR }}
      heading={<div className="kit-kpi__label">{word(spec, 'CVR')}</div>}
      skeleton={{ kind: 'metric' }}
      spec={spec}
      provenance={provenance}
      {...widgetState(query)}
    >
      <div className="kit-kpi__value" style={{ color: METRIC_COLOR.CVR }}>
        {cvrVariant === null ? '—' : fmtPct(cvrVariant)}
      </div>
      <div className="kit-kpi__sub">
        {cvrDefault === null ? `no ${armsOf(spec).control}` : `vs ${fmtPct(cvrDefault)}`}
        {delta === null ? '' : ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} bps`} {kpis === undefined ? null : <Badge confidence={kpis.confidence} z={kpis.z} />}
      </div>
      {series.length > 1 ? <Chart options={options} height={56} title="Conversion rate trend" className="kit-spark" /> : null}
    </Widget>
  )
}
