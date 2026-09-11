/**
 * The sample app. Replace it.
 *
 * It shows the shape of a working dashboard: an AI summary an agent wrote,
 * headline figures that carry their own context, one trend, and two ranked
 * breakdowns where the worst row is findable without reading every number.
 *
 * **Each widget waits for its own query.** The layout — header, controls,
 * cards, headings — renders on the first paint and never unmounts; a card
 * whose rows have not arrived shows a skeleton the size of what is coming.
 * That matters more here than in an ordinary page, because an app runs inside
 * a frame inside the viewer: gate the whole app on `if (data === undefined)`
 * and the reader gets a third consecutive blank screen, after the viewer's own
 * load and the frame's. Never early-return a `Loading…` from the top of `App`.
 *
 * Three things in the layout are worth copying rather than the numbers:
 *
 *   - **The summary sits above the figures**, because it is the only part that
 *     says what to do about them. It renders nothing at all when no agent has
 *     written one — see `SummaryCard`.
 *   - **A KPI carries a badge and a scope line.** "75.7%" is not a fact; "75.7%
 *     across all gateways, up 0.4 points" is. The badge is the movement, the
 *     hint is what the number covers.
 *   - **A ranked chart is baselined, and says so.** These rates sit inside four
 *     points of each other, so a zero baseline would flatten every difference
 *     worth acting on. The axis note under the chart is not optional: a
 *     truncated axis without one is a misleading chart.
 *
 * The only stand-in is `usePretendQuery` below, which fakes the data call
 * because a template cannot know which queries your app will declare. The
 * summary is real: `useAppSummary` talks to the service.
 */

import * as Plot from '@observablehq/plot'
import { useEffect, useMemo, useState } from 'react'
import { Chart } from './components/Chart.js'
import { SkeletonChart, SkeletonMetric, SkeletonTable } from './components/Skeleton.js'
import { SummaryCard } from './components/SummaryCard.js'
import { context } from './studio/context.js'
import { useAppSummary } from './studio/hooks.js'

const RANGES = ['Last 30 days', 'Last 60 days', 'Full range'] as const
type Range = (typeof RANGES)[number]

const SCOPES = ['All gateways', 'Razorpay', 'PayU', 'Cashfree', 'BillDesk'] as const
type Scope = (typeof SCOPES)[number]

type Day = { day: Date; rate: number; attempts: number }
type Slice = { name: string; rate: number; attempts: number }

const DAYS: Record<Range, number> = { 'Last 30 days': 30, 'Last 60 days': 60, 'Full range': 89 }
const SCOPE_SHIFT: Record<Scope, number> = {
  'All gateways': 0,
  Razorpay: -0.13,
  PayU: -0.31,
  Cashfree: -0.36,
  BillDesk: 0.52,
}

function sampleDays(range: Range, scope: Scope): Day[] {
  const count = DAYS[range]
  const end = Date.UTC(2026, 6, 17)
  return Array.from({ length: count }, (_value, index) => {
    const offset = index - count + 1
    return {
      day: new Date(end + offset * 86_400_000),
      rate: 75.6 + Math.sin(index / 3.1) * 0.9 + (index % 11 === 4 ? 1.1 : 0) + SCOPE_SHIFT[scope],
      attempts: 1350 + Math.round(Math.abs(Math.cos(index / 2.4)) * 300),
    }
  })
}

const GATEWAYS: Slice[] = [
  { name: 'BillDesk', rate: 76.43, attempts: 2968 },
  { name: 'Juspay', rate: 75.91, attempts: 2372 },
  { name: 'Paytm Gateway', rate: 75.84, attempts: 3444 },
  { name: 'Stripe India', rate: 75.72, attempts: 2633 },
  { name: 'Instamojo', rate: 75.69, attempts: 2153 },
  { name: 'Cashfree', rate: 75.62, attempts: 5181 },
  { name: 'Razorpay', rate: 75.63, attempts: 12_494 },
  { name: 'PayU', rate: 75.63, attempts: 7176 },
  { name: 'PhonePe Gateway', rate: 75.58, attempts: 1973 },
  { name: 'CCAvenue', rate: 75.57, attempts: 4126 },
]

const METHODS: Slice[] = [
  { name: 'EMI', rate: 76.28, attempts: 2437 },
  { name: 'Credit Card', rate: 76.03, attempts: 12_839 },
  { name: 'Buy Now Pay Later', rate: 75.97, attempts: 3050 },
  { name: 'Cash on Delivery', rate: 75.94, attempts: 2706 },
  { name: 'Debit Card', rate: 75.92, attempts: 7374 },
  { name: 'Prepaid Card', rate: 75.82, attempts: 2213 },
  { name: 'UPI', rate: 75.81, attempts: 5325 },
  { name: 'Wallet', rate: 75.8, attempts: 4240 },
  { name: 'Corporate Card', rate: 75.73, attempts: 2027 },
  { name: 'NetBanking', rate: 73.01, attempts: 3539 },
]

/**
 * DELETE THIS, and use `useAppQuery` instead.
 *
 * It exists only so the sample's controls do something, and so the skeletons
 * below are actually exercised — a stand-in that returned instantly would let
 * a loading bug ship unnoticed. The latency is deliberate and roughly what a
 * real semantic query costs.
 *
 * Your app declares its queries in `bda.manifest.json` and calls:
 *
 *   const daily = useAppQuery('conversion_by_day', {
 *     parameters: { from, to },
 *   })
 *
 * The return shape below is the part that matters: `useAppQuery` gives you the
 * same `{ data, error }`, so swapping it in changes the call and nothing else.
 *
 * Note where the filter goes: into `parameters`, so the service narrows the
 * data. Never filter the returned rows in the component — the service is what
 * knows how much data there is.
 */
function usePretendQuery(range: Range, scope: Scope): { data: Day[] | undefined; error: Error | null } {
  const [data, setData] = useState<Day[]>()

  useEffect(() => {
    let cancelled = false
    // Hold the previous rows rather than blanking on every filter change —
    // `useAppQuery` does this for you with `placeholderData: keepPreviousData`.
    const timer = setTimeout(() => {
      if (!cancelled) setData(sampleDays(range, scope))
    }, 900)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [range, scope])

  return { data, error: null }
}

const count = (value: number) => value.toLocaleString('en-IN')
const percent = (value: number) => `${value.toFixed(1)}%`
const points = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} pts`

export function App() {
  const { appId } = context()
  const [range, setRange] = useState<Range>('Last 30 days')
  const [scope, setScope] = useState<Scope>('All gateways')

  const { data: days, error } = usePretendQuery(range, scope)
  // The one real call in this file. `null` means no agent has written a
  // summary, which `SummaryCard` renders as nothing at all.
  const summary = useAppSummary()

  const pending = days === undefined

  const totals = useMemo(() => {
    if (days === undefined) return undefined
    const attempts = days.reduce((sum, row) => sum + row.attempts, 0)
    // Weight by volume: a mean of daily rates would let a quiet Sunday count
    // as much as a Monday with four times the traffic.
    const successful = days.reduce((sum, row) => sum + (row.rate / 100) * row.attempts, 0)
    const half = Math.floor(days.length / 2)
    const rateOver = (slice: Day[]) => {
      const a = slice.reduce((sum, row) => sum + row.attempts, 0)
      return a === 0 ? 0 : (slice.reduce((sum, row) => sum + (row.rate / 100) * row.attempts, 0) / a) * 100
    }
    return {
      attempts,
      successful: Math.round(successful),
      failed: attempts - Math.round(successful),
      rate: (successful / attempts) * 100,
      shift: rateOver(days.slice(half)) - rateOver(days.slice(0, half)),
    }
  }, [days])

  const trend = useMemo(
    () =>
      days && {
        marginLeft: 44,
        y: { label: null, tickFormat: (value: number) => `${value.toFixed(0)}%`, grid: true },
        x: { label: null },
        marks: [
          Plot.areaY(days, {
            x: 'day',
            y: 'rate',
            fill: 'var(--bda-chart-1)',
            fillOpacity: 0.1,
            curve: 'monotone-x',
          }),
          Plot.lineY(days, {
            x: 'day',
            y: 'rate',
            stroke: 'var(--bda-chart-1)',
            strokeWidth: 2,
            curve: 'monotone-x',
            tip: true,
          }),
        ],
      },
    [days],
  )

  // Both breakdowns are baselined below the worst value, which is why each
  // chart carries a note saying so.
  const ranked = (rows: Slice[], colour: string) => {
    const floor = Math.min(...rows.map((row) => row.rate)) - 0.4
    return {
      marginLeft: 116,
      height: 30 * rows.length + 40,
      x: {
        label: null,
        domain: [floor, Math.max(...rows.map((row) => row.rate)) + 0.1],
        tickFormat: (value: number) => `${value.toFixed(1)}%`,
      },
      y: { label: null },
      marks: [
        Plot.barX(rows, {
          x: 'rate',
          y: 'name',
          fill: colour,
          rx: 3,
          sort: { y: 'x', reverse: true },
          tip: true,
        }),
      ],
    }
  }

  const gatewayChart = useMemo(() => ranked(GATEWAYS, 'var(--bda-chart-3)'), [])
  const methodChart = useMemo(() => ranked(METHODS, 'var(--bda-chart-2)'), [])

  // An error replaces the widgets, because there is nothing to fill them with.
  // A *failure* is worth taking the layout down for; a slow query is not.
  if (error !== null) {
    return <div className="bda-state bda-state--error">{error.message}</div>
  }

  const worstMethod = METHODS.reduce((worst, row) => (row.rate < worst.rate ? row : worst))
  const bestMethodRate = Math.max(...METHODS.map((row) => row.rate))

  return (
    <main>
      <header className="sample-head">
        <div>
          <h1 className="bda-title">
            Payment Health Monitor <span className="bda-badge bda-badge--good">
              <span className="bda-live__dot" aria-hidden="true" /> Live feed
            </span>
          </h1>
          <p className="bda-subtle">
            Checkout success, failure causes and retry recovery · {range.toLowerCase()} · {appId}
          </p>
        </div>
        <fieldset className="bda-controls">
          <legend className="bda-visually-hidden">Range</legend>
          <span className="bda-controls__label" aria-hidden="true">
            Range
          </span>
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className="bda-pill"
              aria-pressed={option === range}
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </fieldset>
      </header>

      <div className="sample-band">
        <SummaryCard summary={summary.error !== null ? null : summary.data} />
      </div>

      <section className="sample-kpis" aria-busy={pending}>
        {pending || totals === undefined ? (
          <>
            <SkeletonMetric />
            <SkeletonMetric />
            <SkeletonMetric />
            <SkeletonMetric />
          </>
        ) : (
          <>
            <Kpi
              value={percent(totals.rate)}
              label="Payment success rate"
              hint={`Scope: ${scope.toLowerCase()}`}
              badge={{ text: points(totals.shift), tone: totals.shift >= 0 ? 'good' : 'bad' }}
              tone="accent"
            />
            <Kpi
              value={count(totals.attempts)}
              label="Checkout attempts"
              hint={`Scope: ${scope.toLowerCase()}`}
              badge={{ text: 'Volume', tone: 'info' }}
            />
            <Kpi
              value={count(totals.successful)}
              label="Successful checkouts"
              hint={`Scope: ${scope.toLowerCase()}`}
              badge={{ text: 'Processed' }}
              tone="positive"
            />
            <Kpi
              value={count(totals.failed)}
              label="Failed attempts"
              hint={`Scope: ${scope.toLowerCase()}`}
              badge={{ text: percent(100 - totals.rate), tone: 'bad' }}
              tone="negative"
            />
          </>
        )}
      </section>

      <section className="bda-card sample-band" aria-busy={trend === undefined}>
        <div className="bda-card__head">
          <div>
            <h2 className="bda-heading">Payment success rate over time</h2>
            <p className="bda-note">Daily successful checkouts ÷ checkout attempts · {scope.toLowerCase()}</p>
          </div>
          <select
            className="bda-select"
            aria-label="Filter by gateway"
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
          >
            {SCOPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        {trend === undefined ? (
          <SkeletonChart height={240} />
        ) : (
          <Chart options={trend} height={240} title="Payment success rate by day" />
        )}
      </section>

      <section className="sample-grid">
        <Breakdown
          title="Success rate by gateway"
          note="Ranked by rate. The axis starts below the worst value, so differences of a few tenths stay visible."
          chart={gatewayChart}
          rows={GATEWAYS}
          label="Gateway"
          pending={pending}
        />
        <Breakdown
          title="Success rate by payment method"
          note={`Across all gateways — the filter above does not apply here. ${worstMethod.name} is ${points(
            worstMethod.rate - bestMethodRate,
          )} behind the best method.`}
          chart={methodChart}
          rows={METHODS}
          label="Method"
          flagged={worstMethod.name}
          pending={pending}
        />
      </section>

      <footer className="sample-foot">
        <span className="bda-badge bda-badge--good">
          <span className="bda-live__dot" aria-hidden="true" /> Gateway heartbeat active
        </span>
        <span>
          {summary.data == null
            ? 'No AI summary yet — run summary_facts, then summary_publish.'
            : `Summary written by ${summary.data.writer.length > 0 ? summary.data.writer : 'an agent'}.`}
        </span>
      </footer>
    </main>
  )
}

type Badge = { text: string; tone?: 'good' | 'bad' | 'info' }

function Kpi({
  value,
  label,
  hint,
  badge,
  tone,
}: {
  value: string
  label: string
  hint: string
  badge?: Badge
  tone?: 'accent' | 'positive' | 'negative'
}) {
  const colour =
    tone === undefined ? undefined : { color: `var(--bda-${tone === 'accent' ? 'accent' : tone})` }
  return (
    <div className="bda-card bda-metric">
      <span className="bda-metric__head">
        <strong className="bda-metric__value" style={colour}>
          {value}
        </strong>
        {badge === undefined ? null : (
          <span className={`bda-badge${badge.tone === undefined ? '' : ` bda-badge--${badge.tone}`}`}>
            {badge.text}
          </span>
        )}
      </span>
      <span className="bda-metric__label">{label}</span>
      <span className="bda-metric__hint">{hint}</span>
    </div>
  )
}

function Breakdown({
  title,
  note,
  chart,
  rows,
  label,
  flagged,
  pending,
}: {
  title: string
  note: string
  chart: Parameters<typeof Chart>[0]['options']
  rows: Slice[]
  label: string
  flagged?: string
  pending: boolean
}) {
  const top = Math.max(...rows.map((row) => row.attempts))
  return (
    <div className="bda-card" aria-busy={pending}>
      <h2 className="bda-heading">{title}</h2>
      <p className="bda-note">{note}</p>
      <Chart options={chart} height={30 * rows.length + 40} title={title} />
      {pending ? (
        <SkeletonTable rows={4} columns={3} />
      ) : (
        <table className="bda-table">
          <thead>
            <tr>
              <th scope="col">{label}</th>
              <th scope="col" className="bda-numeric">
                Attempts
              </th>
              <th scope="col">Share</th>
              <th scope="col" className="bda-numeric">
                Success rate
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => b.attempts - a.attempts)
              .map((row) => (
                <tr key={row.name} className={row.name === flagged ? 'bda-row--flagged' : undefined}>
                  <td>
                    {row.name}
                    {row.name === flagged ? <> <span className="bda-badge bda-badge--bad">Degraded</span></> : null}
                  </td>
                  <td className="bda-numeric">{count(row.attempts)}</td>
                  <td>
                    <span className="bda-bar-track">
                      <span
                        className="bda-bar-fill"
                        style={{ width: `${Math.max(3, (row.attempts / top) * 100).toFixed(1)}%` }}
                      />
                    </span>
                  </td>
                  <td className={`bda-numeric${row.name === flagged ? ' bda-neg' : ''}`}>{percent(row.rate)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
