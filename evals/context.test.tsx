/**
 * T4.5, "Kit: report, never render" — the frame's context reporter.
 *
 * Invariant 9 (AGENTS.md): the chat UI is host-owned; the runtime only
 * reports what is on screen. This pins the wire protocol: a rendered panel
 * shows up in a `studio:sandbox:context` message (`say`, `recipe`, `rect`,
 * `tokens`), a `studio:sandbox:highlight` from the parent adds
 * `kit-card--highlight` to the right card, and picking a row reports a
 * `selection`.
 *
 * Reuses the synthetic spec from `evals/loading.test.tsx` — no real customer
 * or model ids, per `scripts/no-real-ids.sh`.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE } from '../runtime/src/App.js'
import type { Slice } from '../runtime/src/core.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import type { Spec } from '../runtime/src/spec.js'
import { PanelMetaProvider, resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'
import { UiProvider } from '../runtime/src/ui.js'

function ready<T>(rows: T): QueryState<T> {
  return { rows, isPending: false, isFetching: false, error: null, refetch: () => {} }
}

function pending<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

/** Same shape as `evals/loading.test.tsx`'s `CORE_SPEC` — synthetic, no real ids. */
const SPEC: Spec = {
  version: 2,
  model: 'm_retail_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders' },
    { id: 'revenue', column: 'revenue', label: 'Revenue', format: 'currency', role: 'primary' },
  ],
  dimensions: [{ field: 'region', label: 'Region' }],
  questions: [],
  controls: [],
}

const SLICES: Slice[] = [
  { key: 'North', values: ['North'], label: 'Region=North', measures: { orders: 120, revenue: 9800 }, weight: 120 },
  { key: 'South', values: ['South'], label: 'Region=South', measures: { orders: 80, revenue: 6200 }, weight: 80 },
]

const readyCore: CoreData = {
  totals: ready({ orders: 200, revenue: 16000 }),
  series: ready([]),
  // `table`/`ranking` gate on `core.dims` for their loading state and read values through `slicesAt`.
  dims: ready([]),
  trendBy: () => pending(),
  slicesAt: () => SLICES,
}

const pendingCore: CoreData = {
  totals: pending(),
  series: pending(),
  dims: pending(),
  trendBy: () => pending(),
  slicesAt: () => [],
}

/** A fake host frame: makes `window.parent !== window` true, and captures every `postMessage`. */
function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

function restoreHostFrame(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
}

function mountPanel(recipe: string, panelId: string, say: string, core: CoreData) {
  const Recipe = CORE[recipe]
  if (Recipe === undefined) throw new Error(`no such core recipe "${recipe}"`)
  const meta = { panelId, recipe, say, bind: {} }
  return render(
    <UiProvider spec={SPEC}>
      <PanelMetaProvider value={meta}>
        <Recipe spec={SPEC} core={core} bind={{}} />
      </PanelMetaProvider>
    </UiProvider>,
  )
}

/** The debounced (100ms) or rAF-throttled report has had time to fire. */
async function settle(ms = 200): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function contextMessages(postMessage: ReturnType<typeof vi.fn>) {
  return postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === 'studio:sandbox:context')
}

// happy-dom has no CSS engine to cascade `theme.css`'s `:root` rules from a
// stylesheet import, so the token this pins is set directly on the element —
// exactly what `getComputedStyle` reads regardless of where a value came from.
document.documentElement.style.setProperty('--bda-accent', '#1f8ee6')

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  restoreHostFrame()
  vi.restoreAllMocks()
})

describe('reporting a rendered panel', () => {
  it('posts a studio:sandbox:context message with say, recipe, rect and theme tokens', async () => {
    const postMessage = mockHostFrame()
    mountPanel('kpis', 'p0:kpis', 'How big is the number?', pendingCore)
    await settle()

    const messages = contextMessages(postMessage)
    expect(messages.length).toBeGreaterThan(0)
    const latest = messages[messages.length - 1]
    expect(latest.panels.length).toBeGreaterThanOrEqual(1)

    const panel = latest.panels[0]
    expect(panel.say).toBe('How big is the number?')
    expect(panel.recipe).toBe('kpis')
    expect(panel.rect).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }))

    const tokenKeys = Object.keys(latest.tokens)
    expect(tokenKeys.some((key) => key.startsWith('--bda-'))).toBe(true)
  })

  it('never posts while the frame is not embedded (window.parent === window)', async () => {
    restoreHostFrame()
    const postMessage = vi.fn()
    mountPanel('kpis', 'p0:kpis', 'How big is the number?', pendingCore)
    await settle()
    expect(postMessage).not.toHaveBeenCalled()
  })
})

describe('studio:sandbox:highlight', () => {
  it('adds kit-card--highlight to the right card and no other', async () => {
    mockHostFrame()
    mountPanel('kpis', 'p0:kpis', 'How big is the number?', pendingCore)
    mountPanel('narrative', 'p1:narrative', 'What stands out?', pendingCore)
    await settle()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:highlight', panelId: 'p0:kpis' } }))
    })

    const cards = document.querySelectorAll('.kit-card--highlight')
    expect(cards.length).toBeGreaterThan(0)
    // Every highlighted card belongs to the kpis section, not the narrative one.
    for (const card of cards) expect(card.closest('.kit-icard')).toBeNull()
  })
})

describe('selection', () => {
  it('reports the picked row as `selection` on a new context message', async () => {
    const postMessage = mockHostFrame()
    mountPanel('table', 'p2:table', 'Every region', readyCore)
    await settle()
    const before = contextMessages(postMessage).length

    const row = screen.getByText('North').closest('tr') as HTMLElement | null
    expect(row).not.toBeNull()
    act(() => {
      row?.click()
    })
    await settle()

    const messages = contextMessages(postMessage)
    expect(messages.length).toBeGreaterThan(before)
    const withSelection = messages.find((message) => message.panels.some((panel: { panelId: string }) => panel.panelId === 'p2:table' && panel.selection !== undefined))
    expect(withSelection).toBeDefined()
    const panel = withSelection.panels.find((p: { panelId: string }) => p.panelId === 'p2:table')
    expect(panel.selection).toMatchObject({ key: 'North' })
  })
})
