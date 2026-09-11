/**
 * The sample app. Replace it.
 *
 * It shows the shape of a working app: filters whose values are passed *into*
 * the data call rather than applied to the rows afterwards, metrics and charts
 * derived from whatever came back, and Observable Plot for the drawing.
 *
 * The three controls are also the three shapes worth knowing, and which one to
 * reach for is a question about the options, not about taste:
 *
 *   - **Pills** for a handful of mutually exclusive choices (`Year`). Every
 *     option is visible, switching costs one click, and the reader learns what
 *     else exists.
 *   - **A select** once there are more than about five (`Region`). Native, so
 *     the list is painted outside the page and cannot be clipped by the frame.
 *   - **A checkbox** for something on or off. This one is a *display* option —
 *     it draws a reference line and changes no query. Anything that narrows
 *     the data belongs in `parameters` instead.
 *
 * A multi-select is a `fieldset.bda-checkboxes` of those checkboxes, and it
 * wires to the `in` filter operator rather than to a parameter. See
 * README-FOR-AGENTS.md.
 *
 * The only stand-in is `queryStandIn` below, which fakes the data call because
 * a template cannot know which queries your app will declare. Everything else
 * is the real pattern.
 */

import * as Plot from '@observablehq/plot'
import { useMemo, useState } from 'react'
import { Chart } from './components/Chart.js'
import { context } from './studio/context.js'

type Row = { month: Date; revenue: number; cups: number }

const YEARS = ['All', '2025', '2026'] as const
type Year = (typeof YEARS)[number]

const REGIONS = ['All regions', 'North', 'East', 'South', 'West', 'Central'] as const
type Region = (typeof REGIONS)[number]

/** Stand-in for what a `region` parameter would narrow to. */
const REGION_SHARE: Record<Region, number> = {
  'All regions': 1,
  North: 0.31,
  East: 0.24,
  South: 0.18,
  West: 0.15,
  Central: 0.12,
}

/**
 * DELETE THIS, and use `useAppQuery` instead.
 *
 * It exists only so the sample's controls do something. Your app declares its
 * queries in `bda.manifest.json` and calls:
 *
 *   const monthly = useAppQuery('revenue_by_month', {
 *     parameters: { year, region },
 *   })
 *
 *   if (monthly.error !== null) {
 *     return <div className="bda-state bda-state--error">{monthly.error.message}</div>
 *   }
 *   // Narrow on `data`, not `isPending` — with more than one query the flags
 *   // do not convince TypeScript that `data` is present.
 *   if (monthly.data === undefined) return <div className="bda-state">Loading…</div>
 *   const rows = toObjects(monthly.data)
 *
 * Note where the filter goes: into `parameters`, so the service narrows the
 * data. Never filter the returned rows in the component — the service is what
 * knows how much data there is.
 */
function queryStandIn(year: Year, region: Region): Row[] {
  // Offsets from the start of 2025, so each year is a genuinely different
  // slice rather than the same twelve numbers with a different label.
  const offsets =
    year === 'All'
      ? Array.from({ length: 24 }, (_value, index) => index)
      : Array.from({ length: 12 }, (_value, index) => index + (year === '2026' ? 12 : 0))

  const share = REGION_SHARE[region]

  return offsets.map((offset) => ({
    month: new Date(Date.UTC(2025, offset, 1)),
    revenue: Math.round((120_000 + Math.sin(offset / 1.7) * 45_000 + offset * 6_800) * share),
    cups: Math.round((38_000 + Math.cos(offset / 2.1) * 9_000 + offset * 900) * share),
  }))
}

const MIX = [
  { product: 'Espresso', share: 31 },
  { product: 'Latte', share: 24 },
  { product: 'Cold brew', share: 18 },
  { product: 'Filter', share: 14 },
  { product: 'Mocha', share: 13 },
]

const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2)}M`
    : `$${Math.round(value / 1_000).toLocaleString()}K`

export function App() {
  const { appId, version } = context()
  const [year, setYear] = useState<Year>('All')
  const [region, setRegion] = useState<Region>('All regions')
  const [average, setAverage] = useState(false)

  // The filters are inputs to the data call, which is why everything below
  // recomputes when they change.
  const rows = useMemo(() => queryStandIn(year, region), [year, region])

  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const cups = rows.reduce((sum, row) => sum + row.cups, 0)
  const meanRevenue = rows.length === 0 ? 0 : revenue / rows.length

  // Plot options are memoised on the data, so a chart is rebuilt when the
  // rows change and not on every render.
  const revenueByMonth = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => `${Math.round(value / 1_000)}K` },
      x: { label: null, type: 'band' as const, tickFormat: '%b %y' },
      marks: [
        Plot.barY(rows, { x: 'month', y: 'revenue', fill: 'var(--bda-chart-1)', rx: 3, tip: true }),
        // The checkbox adds a mark; it does not re-request anything.
        ...(average
          ? [
              Plot.ruleY([meanRevenue], {
                stroke: 'var(--bda-text-secondary)',
                strokeDasharray: '3,4',
              }),
            ]
          : []),
      ],
    }),
    [rows, average, meanRevenue],
  )

  const cupsTrend = useMemo(
    () => ({
      y: { label: null, tickFormat: (value: number) => `${Math.round(value / 1_000)}K` },
      x: { label: null },
      marks: [
        Plot.areaY(rows, {
          x: 'month',
          y: 'cups',
          fill: 'var(--bda-chart-2)',
          fillOpacity: 0.16,
          curve: 'catmull-rom',
        }),
        Plot.lineY(rows, {
          x: 'month',
          y: 'cups',
          stroke: 'var(--bda-chart-2)',
          strokeWidth: 2,
          curve: 'catmull-rom',
          tip: true,
        }),
      ],
    }),
    [rows],
  )

  const mix = useMemo(
    () => ({
      marginLeft: 92,
      x: { label: null, tickFormat: (value: number) => `${value}%` },
      y: { label: null },
      marks: [
        Plot.barX(MIX, {
          x: 'share',
          y: 'product',
          fill: 'product',
          rx: 3,
          sort: { y: 'x', reverse: true },
          tip: true,
        }),
      ],
    }),
    [],
  )

  return (
    <main>
      <header className="sample-head">
        <div>
          <h1 className="bda-title">Data app</h1>
          <p className="bda-subtle">
            {appId} · version {version} · sample data
          </p>
        </div>
        <div className="bda-controls bda-controls--spread">
          <fieldset className="bda-controls">
            <legend className="bda-visually-hidden">Year</legend>
            <span className="bda-controls__label" aria-hidden="true">
              Year
            </span>
            {YEARS.map((option) => (
              <button
                key={option}
                type="button"
                className="bda-pill"
                aria-pressed={option === year}
                onClick={() => setYear(option)}
              >
                {option}
              </button>
            ))}
          </fieldset>

          <label className="bda-controls__label" htmlFor="sample-region">
            Region
          </label>
          <select
            id="sample-region"
            className="bda-select"
            value={region}
            onChange={(event) => setRegion(event.target.value as Region)}
          >
            {REGIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <label className="bda-checkbox">
            <input type="checkbox" checked={average} onChange={(event) => setAverage(event.target.checked)} />
            12-month average
          </label>
        </div>
      </header>

      <section className="sample-metrics">
        <Metric value={compactMoney(revenue)} label="Revenue" />
        <Metric value={`${Math.round(cups / 1_000)}K`} label="Cups sold" tone={2} />
        <Metric value={`${rows.length}`} label="Months" tone={3} />
      </section>

      <section className="sample-grid">
        <div className="bda-card">
          <h2 className="bda-heading">Monthly revenue</h2>
          <Chart options={revenueByMonth} title="Revenue by month" />
        </div>
        <div className="bda-card">
          <h2 className="bda-heading">Cups sold trend</h2>
          <Chart options={cupsTrend} title="Cups sold by month" />
        </div>
      </section>

      <section className="bda-card">
        <h2 className="bda-heading">Product mix</h2>
        <Chart options={mix} height={200} title="Share of sales by product" />
      </section>
    </main>
  )
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: 2 | 3 }) {
  return (
    <div className="bda-metric">
      <strong
        className="bda-metric__value"
        style={tone === undefined ? undefined : { color: `var(--bda-chart-${tone})` }}
      >
        {value}
      </strong>
      <span className="bda-metric__label">{label}</span>
    </div>
  )
}
