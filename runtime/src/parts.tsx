/** Small shared pieces every recipe reaches for. */

import type { ReactNode } from 'react'
import type { Confidence } from './analysis.js'
import type { CoreData, Dataset } from './data.js'
import { fmtSigned } from './format.js'
import type { MetricOrCvr, Spec } from './spec.js'

export const METRIC_COLOR: Record<MetricOrCvr, string> = {
  NIBPD: 'var(--bda-chart-1)',
  NIBrPD: 'var(--bda-chart-2)',
  NICPD: 'var(--bda-chart-3)',
  CVR: 'var(--bda-chart-4)',
}

export const METRIC_TITLE: Record<MetricOrCvr, string> = {
  NIBPD: 'Net Incremental Bookings per Day',
  NIBrPD: 'Net Incremental Bookers per Day',
  NICPD: 'Net Incremental Commerce per Day',
  CVR: 'Conversion Rate',
}

/** A stable series colour per core measure: its position in the spec. */
export function measureColor(spec: Spec, measureId: string): string {
  const index = spec.measures.findIndex((measure) => measure.id === measureId)
  return `var(--bda-chart-${(Math.max(index, 0) % 6) + 1})`
}

export const BADGE_COLOR: Record<Confidence, string> = {
  '99%': 'var(--bda-positive)',
  '95%': 'var(--bda-chart-3)',
  '90%': 'var(--bda-chart-1)',
  '80%': 'var(--bda-chart-4)',
  '<80%': 'var(--bda-text-secondary)',
  'N/A': 'var(--bda-text-secondary)',
}

/** ab_test recipes. */
export type RecipeProps = {
  readonly spec: Spec
  readonly data: Dataset
  readonly bind: Readonly<Record<string, unknown>>
}

/** Core recipes. */
export type CoreProps = {
  readonly spec: Spec
  readonly core: CoreData
  readonly bind: Readonly<Record<string, unknown>>
}

export function Badge({ confidence, z }: { confidence: Confidence; z: number }) {
  const color = BADGE_COLOR[confidence]
  return (
    <span className="kit-badge" style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      {confidence === 'N/A' ? 'N/A' : `${confidence} (z=${z.toFixed(2)})`}
    </span>
  )
}

export function Signed({ value, currency }: { value: number | null; currency?: boolean }) {
  if (value === null) return <>{'—'}</>
  return <span style={{ color: value >= 0 ? 'var(--bda-positive)' : 'var(--bda-negative)' }}>{fmtSigned(value, currency === true)}</span>
}

export function Legend({ items }: { items: readonly { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="kit-legend">
      {items.map((item) => (
        <span key={item.label} className="kit-legend__item">
          <span className={`kit-legend__swatch${item.dashed === true ? ' kit-legend__swatch--dashed' : ''}`} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="kit-sh kit-sh--row">
      <span>{title}</span>
      {right}
    </div>
  )
}

export function Card({ label, value, hint, tone, small }: { label: string; value: string; hint?: ReactNode; tone?: 'positive' | 'negative' | 'warn' | 'cvr' | 'accent'; small?: boolean }) {
  const color =
    tone === 'positive' ? 'var(--bda-positive)' : tone === 'negative' ? 'var(--bda-negative)' : tone === 'warn' || tone === 'cvr' ? 'var(--bda-chart-4)' : tone === 'accent' ? 'var(--bda-chart-1)' : undefined
  return (
    <div className="kit-card">
      <span className="kit-card__label">{label}</span>
      <span className={`kit-card__value${small === true ? ' kit-card__value--small' : ''}`} style={color === undefined ? undefined : { color }}>
        {value}
      </span>
      {hint === undefined ? null : <span className="kit-card__hint">{hint}</span>}
    </div>
  )
}

export function statusTone(status: string): 'positive' | 'negative' | 'warn' {
  const upper = status.toUpperCase()
  return upper.includes('WIN') ? 'positive' : upper.includes('LOSE') ? 'negative' : 'warn'
}

export function trafficSplit(data: Dataset, control: string): string {
  const first = data.overall[0]
  if (first === undefined) return '—'
  const total = first.participantsTotal
  const pct = (count: number) => (total > 0 ? `${((count / total) * 100).toFixed(2).replace(/\.00$/, '')}%` : '—')
  const parts = [`${pct(first.participantsDefault)} (${control})`, ...data.overall.map((variant) => `${pct(variant.participants)} (${variant.name})`)]
  return parts.join(' | ')
}
