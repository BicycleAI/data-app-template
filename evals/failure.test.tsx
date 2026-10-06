/**
 * A failed or timed-out query never reads as a number. Seen in a live app: queries failed during a service
 * redeploy and a finding read "₹0 last week, 0.0% vs its 12-week average" as if it were true.
 *
 * Every recipe is rendered with its datasets failed (all at once, and for core recipes each dataset alone
 * while the others hold real rows). Nothing may render a zero amount, a zero rate or a zero change; the
 * failed card says "Couldn't load" with a Retry.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AB, CORE } from '../runtime/src/App.js'
import { buildSeries, buildTotals, rollup } from '../runtime/src/core.js'
import type { CoreData, Dataset, QueryState } from '../runtime/src/data.js'
import { setCurrency } from '../runtime/src/format.js'
import type { AbFamily, Spec } from '../runtime/src/spec.js'
import { BdaError } from '../runtime/src/studio/types.js'
import { EMPTY_TEXT } from '../runtime/src/parts.js'
import { UiProvider } from '../runtime/src/ui.js'

afterEach(() => {
  cleanup()
  setCurrency(undefined)
})

const failed = <T,>(): QueryState<T> => ({ rows: undefined, isPending: false, isFetching: false, error: new BdaError('host_timeout', 'The host did not answer the query.', 0), refetch: () => {} })
const ready = <T,>(rows: T): QueryState<T> => ({ rows, isPending: false, isFetching: false, error: null, refetch: () => {} })

const SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  currency: 'INR',
  time: { from: '2026-01-01', to: '2026-01-29', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders', role: 'primary' },
    { id: 'revenue', column: 'revenue', label: 'Revenue', format: 'currency' },
    { id: 'refund_rate', column: 'refund_rate', label: 'Refund rate', format: 'rate', good: 'down' },
  ],
  dimensions: [{ field: 'region', label: 'Region' }],
  questions: [],
  controls: [{ kind: 'dimensions' }, { kind: 'measure' }, { kind: 'heatmap_axes' }, { kind: 'depth' }],
}

const DAYS = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10))
const TIME_ROWS = DAYS.map((day, i) => ({ period: day, orders: 100 + i, revenue: 450_000 + i * 1000, refund_rate: 3 + i / 10 }))
const DIM_ROWS = ['North', 'South'].flatMap((region) => TIME_ROWS.slice(0, 1).map((row) => ({ region, orders: row.orders, revenue: row.revenue, refund_rate: row.refund_rate })))

const readyCore = (): CoreData => ({
  totals: ready(buildTotals(SPEC, [{ orders: 3000, revenue: 13_000_000, refund_rate: 3.2 }])),
  series: ready(buildSeries(SPEC, TIME_ROWS)),
  dims: ready(DIM_ROWS),
  trendBy: () => ready(DIM_ROWS),
  slicesAt: (fields) => rollup(SPEC, DIM_ROWS, fields),
})

/** A zero amount, a zero rate or a zero change: what a failure must never turn into. */
const ZERO = /[₹$]\s?0(?![\d.,])|(?<![\d.,])0(\.0+)?\s?%|[+−-]0(\.0+)?\s?pts|(?<![\d.,])0(\.0+)? L\b/

function renderCore(id: string, core: CoreData) {
  setCurrency('INR')
  const Recipe = CORE[id]
  if (Recipe === undefined) throw new Error(id)
  return render(
    <UiProvider spec={SPEC}>
      <Recipe spec={SPEC} core={core} bind={{}} />
    </UiProvider>,
  )
}

describe('a failed query never renders as zero (core)', () => {
  for (const id of Object.keys(CORE)) {
    it(`${id}: every dataset failed`, () => {
      const { container } = renderCore(id, { totals: failed(), series: failed(), dims: failed(), trendBy: () => failed(), slicesAt: () => [] })
      const text = container.textContent ?? ''
      expect(text).not.toMatch(ZERO)
      // `summary` asks the host, not a query; it has its own error state (evals/summary.test.tsx).
      if (id !== 'summary') expect(text).toContain("Couldn't load")
    })
    for (const key of ['totals', 'series', 'dims'] as const) {
      it(`${id}: only ${key} failed`, () => {
        const core = { ...readyCore(), [key]: failed() }
        const { container } = renderCore(id, key === 'dims' ? { ...core, slicesAt: () => [], trendBy: () => failed() } : core)
        expect(container.textContent ?? '').not.toMatch(ZERO)
      })
    }
  }
})

const AB_FAMILY: AbFamily = {
  kind: 'ab_test',
  arms: { field: 'arm', control: 'CONTROL' },
  roles: { bookers: 'bookers', orders: 'orders', value: 'value', participants: { arm: 'participants_arm', control: 'participants_control', total: 'participants_total' } },
}
const AB_SPEC: Spec = {
  ...SPEC,
  measures: ['bookers', 'orders', 'value', 'participants_arm', 'participants_control', 'participants_total'].map((id) => ({ id, column: id, label: id, ...(id === 'value' ? { format: 'currency' as const } : {}) })),
  family: AB_FAMILY,
  controls: [{ kind: 'dimensions' }, { kind: 'measure' }, { kind: 'variant' }, { kind: 'heatmap_axes' }, { kind: 'depth' }],
}

describe('a failed query never renders as zero (ab_test)', () => {
  for (const [id, Recipe] of Object.entries(AB)) {
    it(`${id}: every dataset failed`, () => {
      const data: Dataset = { meta: failed(), overall: failed(), trend: failed(), segmentsAt: () => failed() }
      const { container } = render(
        <UiProvider spec={AB_SPEC}>
          <Recipe spec={AB_SPEC} data={data} bind={{}} />
        </UiProvider>,
      )
      const text = container.textContent ?? ''
      expect(text).not.toMatch(ZERO)
      expect(text).toContain("Couldn't load")
    })
  }
})

describe('an empty answer is not a failure, and not a zero', () => {
  const empty = (): CoreData => ({
    totals: ready(buildTotals(SPEC, [])),
    series: ready([]),
    dims: ready([]),
    trendBy: () => ready([]),
    slicesAt: () => [],
  })
  for (const id of Object.keys(CORE)) {
    it(`${id}: no rows`, () => {
      const text = renderCore(id, empty()).container.textContent ?? ''
      expect(text).not.toMatch(ZERO)
      expect(text).not.toContain("Couldn't load")
    })
  }
  it('says "No data for this window" where a chart would be', () => {
    expect(renderCore('trend', empty()).container.textContent).toContain(EMPTY_TEXT)
  })
})
