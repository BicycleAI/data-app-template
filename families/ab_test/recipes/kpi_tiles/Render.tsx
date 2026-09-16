import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import type { TrendPoint, VariantOverall } from '../../../../runtime/src/analysis.js'
import { Chart } from '../../../../runtime/src/components/Chart.js'
import { fmtPct, fmtSigned } from '../../../../runtime/src/format.js'
import { Badge, Card, METRIC_COLOR, METRIC_TITLE, type RecipeProps, statusTone } from '../../../../runtime/src/parts.js'
import { armsOf, controlEnabled, type Metric, METRICS, type Spec, word } from '../../../../runtime/src/spec.js'
import { activeVariant, useUi } from '../../../../runtime/src/ui.js'

/**
 * Two styles. `row` is the report's compact overview strip (id, product,
 * status, variant, KPIs, CVR). `spark` is the explorer's tiles with a
 * sparkline under each number.
 */
export function Render({ spec, data, bind }: RecipeProps) {
  const ui = useUi()
  const variant = activeVariant(data, ui.variantIndex)
  if (variant === undefined) return null
  const style = bind.style === 'spark' ? 'spark' : 'row'
  const trend = data.trend.filter((point) => point.variant === variant.name)

  if (style === 'spark') {
    return (
      <section className="kit-kpis">
        {METRICS.map((metric) => (
          <SparkTile key={metric} spec={spec} metric={metric} variant={variant} trend={trend} active={metric === ui.metric && controlEnabled(spec, 'measure')} />
        ))}
        <CvrSparkTile spec={spec} variant={variant} trend={trend} />
      </section>
    )
  }

  const next = (ui.variantIndex + 1) % data.overall.length
  return (
    <section className="kit-section">
      <div className="kit-ovrow">
        <Card label={spec.entity?.label ?? 'Entity'} value={data.meta.entityId} {...(data.meta.tag.length > 0 ? { hint: data.meta.tag } : {})} />
        {data.meta.group.length > 0 ? <Card label="Primary product" value={data.meta.group} /> : null}
        <Card label="Status" value={data.meta.status || 'Unknown'} tone={statusTone(data.meta.status)} />
        {data.overall.length > 1 && controlEnabled(spec, 'variant') ? (
          <button type="button" className="kit-card kit-card--button" onClick={() => ui.setVariantIndex(next)}>
            <span className="kit-card__label">Variant</span>
            <span className="kit-card__value" style={{ color: `var(--bda-chart-${(ui.variantIndex % 4) + 1})` }}>
              {variant.name}
            </span>
            <span className="kit-card__hint">
              {'→'} {data.overall[next]?.name}
            </span>
          </button>
        ) : (
          <Card label="Variant" value={variant.name} tone="accent" />
        )}
        {METRICS.map((metric) => {
          const value = variant.kpis[metric]
          return <Card key={metric} label={word(spec, metric)} value={fmtSigned(value, metric === 'NICPD')} {...(value === null ? {} : { tone: value >= 0 ? 'positive' : 'negative' })} />
        })}
        <Card
          label={word(spec, 'CVR')}
          value={variant.kpis.cvrVariant === null ? '—' : fmtPct(variant.kpis.cvrVariant)}
          {...(variant.kpis.cvrDefault === null ? {} : { hint: `vs ${fmtPct(variant.kpis.cvrDefault)} (${armsOf(spec).control})` })}
          tone="cvr"
        />
        <Card label="Data as of" value={data.meta.window.dataAsOf} hint={<Badge confidence={variant.kpis.confidence} z={variant.kpis.z} />} small />
      </div>
    </section>
  )
}

const SPARK = { marginLeft: 4, marginRight: 4, marginTop: 4, marginBottom: 4, x: { axis: null }, y: { axis: null, grid: false } }

function SparkTile({ spec, metric, variant, trend, active }: { spec: Spec; metric: Metric; variant: VariantOverall; trend: readonly TrendPoint[]; active: boolean }) {
  const value = variant.kpis[metric]
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
    <div className={`bda-card kit-kpi${active ? ' kit-kpi--active' : ''}`} style={{ borderTopColor: METRIC_COLOR[metric] }}>
      <div className="kit-kpi__label">{word(spec, metric)}</div>
      <div className="kit-kpi__value" style={{ color: value === null ? undefined : value >= 0 ? 'var(--bda-positive)' : 'var(--bda-negative)' }}>
        {fmtSigned(value, metric === 'NICPD')}
      </div>
      <div className="kit-kpi__sub">{METRIC_TITLE[metric]}</div>
      {series.length > 1 ? <Chart options={options} height={56} title={`${metric} trend`} className="kit-spark" /> : null}
    </div>
  )
}

function CvrSparkTile({ spec, variant, trend }: { spec: Spec; variant: VariantOverall; trend: readonly TrendPoint[] }) {
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
  const { cvrVariant, cvrDefault, confidence, z } = variant.kpis
  const delta = cvrVariant === null || cvrDefault === null ? null : (cvrVariant - cvrDefault) * 10_000
  return (
    <div className="bda-card kit-kpi" style={{ borderTopColor: METRIC_COLOR.CVR }}>
      <div className="kit-kpi__label">{word(spec, 'CVR')}</div>
      <div className="kit-kpi__value" style={{ color: METRIC_COLOR.CVR }}>
        {cvrVariant === null ? '—' : fmtPct(cvrVariant)}
      </div>
      <div className="kit-kpi__sub">
        {cvrDefault === null ? `no ${armsOf(spec).control}` : `vs ${fmtPct(cvrDefault)}`}
        {delta === null ? '' : ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} bps`} · <Badge confidence={confidence} z={z} />
      </div>
      {series.length > 1 ? <Chart options={options} height={56} title="Conversion rate trend" className="kit-spark" /> : null}
    </div>
  )
}
