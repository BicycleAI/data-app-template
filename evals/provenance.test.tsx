/**
 * T3.5, "Provenance — How is this computed?"
 *
 * Everything the popover shows travels WITH the composed app already: the
 * declared queries (`window.__DATA_APP_QUERIES`, see `compose/bundle.mjs`'s
 * line-2 contract and `spec.ts`'s `loadQueries`), the current filter/time
 * picks (`useControls()`), a measure's `definition` and a panel's `explain`
 * (`usePanelMeta()`). This pins that clicking the affordance shows the
 * substituted SQL (a real date where `:from` was, not the token itself), the
 * measure's definition and the panel's Method sentence — never a fetch, never
 * a blank state.
 *
 * Synthetic spec only — no real customer or model ids, per `scripts/no-real-ids.sh`.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CORE } from '../runtime/src/App.js'
import { ControlsProvider } from '../runtime/src/controls.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import type { QuerySpec, Spec } from '../runtime/src/spec.js'
import { PanelMetaProvider, resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'
import { UiProvider } from '../runtime/src/ui.js'

function ready<T>(rows: T): QueryState<T> {
  return { rows, isPending: false, isFetching: false, error: null, refetch: () => {} }
}

/** A `filter` control (`region`, multi, default `[emea]`, 2 options → 2 slots) plus a fixed time range — so `:from`/`:to`/`:region_0` all resolve to known values. */
const SPEC: Spec = {
  version: 2,
  model: 'm_retail_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [{ id: 'orders', column: 'orders_total', label: 'Orders', definition: 'Count of completed orders in the window.' }],
  dimensions: [{ field: 'region', label: 'Region' }],
  questions: [],
  controls: [{ kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer'], default: ['emea'] }],
}

/** `totals` as the composer would have rendered it — `:from`/`:to` plus the `region` filter's two slots. */
const QUERIES: readonly QuerySpec[] = [
  {
    id: 'totals',
    sql: 'SELECT sum(orders_total) AS orders_total FROM m_retail_demo WHERE event_time BETWEEN :from AND :to AND region IN (:region_0, :region_1)',
    parameters: [
      { name: 'from', type: 'date', required: true },
      { name: 'to', type: 'date', required: true },
      { name: 'region_0', type: 'string', required: true, default: 'emea' },
      { name: 'region_1', type: 'string', required: true, default: 'emea' },
    ],
  },
]

const readyCore: CoreData = {
  totals: ready({ orders: 200 }),
  series: ready([]),
  dims: ready([]),
  trendBy: () => ready([]),
  slicesAt: () => [],
}

const EXPLAIN = 'Tiles showing current totals and period-over-period change.'

function mountKpis() {
  window.__DATA_APP_QUERIES = QUERIES
  const meta = { panelId: 'p0:kpis', recipe: 'kpis', say: 'How big is each measure?', bind: {}, explain: EXPLAIN }
  const Recipe = CORE.kpis
  if (Recipe === undefined) throw new Error('no "kpis" core recipe')
  return render(
    <UiProvider spec={SPEC}>
      <ControlsProvider spec={SPEC}>
        <PanelMetaProvider value={meta}>
          <Recipe spec={SPEC} core={readyCore} bind={{}} />
        </PanelMetaProvider>
      </ControlsProvider>
    </UiProvider>,
  )
}

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  delete window.__DATA_APP_QUERIES
})

describe('the "How is this computed?" affordance', () => {
  it('is a keyboard-reachable button, closed until clicked', () => {
    mountKpis()
    const trigger = screen.getAllByRole('button', { name: 'How is this computed?' })[0]
    expect(trigger).toBeDefined()
    expect(screen.queryByRole('dialog', { name: 'How is this computed?' })).toBeNull()
  })

  it('shows the substituted SQL, the measure definition and the panel explain on click', () => {
    mountKpis()
    const trigger = screen.getAllByRole('button', { name: 'How is this computed?' })[0] as HTMLElement
    fireEvent.click(trigger)

    const popover = screen.getAllByRole('dialog', { name: 'How is this computed?' })[0]
    expect(popover).toBeDefined()
    const text = popover.textContent ?? ''

    // The `:from` token is gone, replaced by the currently applied date — not the literal token.
    expect(text).not.toContain(':from')
    expect(text).toContain('2026-01-01')
    // The filter slot is substituted too, quoted as a SQL string literal.
    expect(text).toContain("'emea'")

    // The measure's semantic-layer definition.
    expect(text).toContain('Count of completed orders in the window.')

    // The recipe's `explain` sentence (the Method section).
    expect(text).toContain(EXPLAIN)
  })

  it('closes on a second click', () => {
    mountKpis()
    const trigger = screen.getAllByRole('button', { name: 'How is this computed?' })[0] as HTMLElement
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog', { name: 'How is this computed?' })).not.toBeNull()
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog', { name: 'How is this computed?' })).toBeNull()
  })
})
