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
 * It also pins the page `scope` every message carries: the whole page as the
 * host's chat applies it to every query, defaults included, and each card's
 * `queryId` and resolved `bind`.
 *
 * Reuses the synthetic spec from `evals/loading.test.tsx` — no real customer
 * or model ids, per `scripts/no-real-ids.sh`.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App, CORE } from '../runtime/src/App.js'
import { applyRenderState } from '../runtime/src/controls.js'
import type { Slice } from '../runtime/src/core.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import type { Spec } from '../runtime/src/spec.js'
import { initContext } from '../runtime/src/studio/context.js'
import { PanelMetaProvider, type PanelReport, resetRegistryForTests, setPageScope } from '../runtime/src/studio/contextRegistry.js'
import { createQueryClient } from '../runtime/src/studio/hooks.js'
import { type PageScope, pageScope, SCOPE_LIMITS } from '../runtime/src/studio/scope.js'
import type { BdaContext, RenderState } from '../runtime/src/studio/types.js'
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

/* ------------------------------------------------------------ page scope */

/** An explorer-style app with every control the scope reports: measure, dimensions, a time preset and three filters. */
const EXPLORER: Spec = {
  version: 2,
  model: 'm_retail_demo',
  title: 'Demo explorer',
  persona: 'analyst',
  template: 'explorer',
  chrome: 'explorer',
  time: { column: 'event_time', from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders_total', label: 'Orders', role: 'primary' },
    { id: 'revenue', column: 'revenue_total', label: 'Revenue', format: 'currency' },
  ],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
    { field: 'category', label: 'Category' },
  ],
  panels: [
    { recipe: 'verdict', bind: {} },
    { recipe: 'kpis', bind: { style: 'spark' } },
    { recipe: 'breakdown', bind: { dims: 'all', limit: 12 } },
  ],
  questions: [],
  controls: [
    { kind: 'measure' },
    { kind: 'dimensions' },
    { kind: 'time', presets: ['7d', '30d', '90d'], default: '30d' },
    { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'], default: ['emea', 'amer'] },
    { kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'], default: 'web' },
    // No default, so it starts with every option picked: "All", which narrows nothing.
    { kind: 'filter', dim: 'category', multi: true, options: ['toys', 'books'] },
  ],
  rules: { compare_periods: 7 },
}

const WITH_ENTITY: Spec = {
  ...EXPLORER,
  entity: { field: 'store_id', label: 'Store', type: 'string' },
  controls: [{ kind: 'entity' }, ...(EXPLORER.controls ?? [])],
}

/** What the untouched EXPLORER page reports. */
const UNTOUCHED: PageScope = {
  complete: true,
  model: 'm_retail_demo',
  // `to` is exclusive, exactly as every query reads it: `event_time >= :from AND event_time < :to`.
  window: { column: 'event_time', from: '2026-01-02', to: '2026-02-01', preset: '30d', grain: 'day', isDefault: true },
  filters: [
    { field: 'region', label: 'Region', values: ['emea', 'amer'], isDefault: true },
    { field: 'channel', label: 'Channel', values: ['web'], isDefault: true },
  ],
  measure: { id: 'orders', column: 'orders_total', label: 'Orders' },
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
    { field: 'category', label: 'Category' },
  ],
  compare: { periods: 7, grain: 'day' },
}

type Message = Record<string, unknown>

function sent(postMessage: ReturnType<typeof vi.fn>, match: (message: Message) => boolean): Message[] {
  return postMessage.mock.calls.map((call) => call[0] as Message).filter((message) => message !== null && typeof message === 'object' && match(message))
}

function latestContext(postMessage: ReturnType<typeof vi.fn>): { scope?: PageScope; panels: PanelReport[] } {
  const latest = contextMessages(postMessage).at(-1)
  if (latest === undefined) throw new Error('no studio:sandbox:context message yet')
  return latest
}

function panelOf(postMessage: ReturnType<typeof vi.fn>, panelId: string): PanelReport | undefined {
  return latestContext(postMessage).panels.find((panel) => panel.panelId === panelId)
}

function injectState(state: RenderState | undefined): void {
  const { state: _previous, ...rest } = window.__BDA_CONTEXT as BdaContext
  window.__BDA_CONTEXT = state === undefined ? rest : { ...rest, state }
}

function mountApp(spec: Spec = EXPLORER) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <App spec={spec} />
    </QueryClientProvider>,
  )
}

/** Well inside the 100ms registry debounce: only the next-frame report can have gone out. */
const NEXT_FRAME_MS = 30

describe('the page scope on studio:sandbox:context', () => {
  beforeAll(async () => {
    // The whole app issues queries, which need an app identity; the embed page would inject this.
    window.__BDA_CONTEXT = { v: 1, appId: 'app_demo', version: 1, apiBase: '/api', token: 'tkn', expiresAt: '2099-01-01T00:00:00.000Z', theme: 'light', themePreference: 'light' }
    await initContext()
  })

  afterEach(() => injectState(undefined))

  it('an untouched page reports all of it: the window the queries read, the default filters, the measure and every dimension', async () => {
    const postMessage = mockHostFrame()
    mountApp()
    await settle()

    const messages = contextMessages(postMessage)
    expect(messages[0]?.scope, 'the first report already carries it').toEqual(UNTOUCHED)
    expect(latestContext(postMessage).scope).toEqual(UNTOUCHED)

    // The window is the queries' own `:from`/`:to`, not a display range.
    const query = sent(postMessage, (message) => message.type === 'studio:sandbox:query')[0] as { options: { parameters: Record<string, unknown> } } | undefined
    expect(query?.options.parameters).toMatchObject({ from: UNTOUCHED.window?.from, to: UNTOUCHED.window?.to })

    // The URL's delta is untouched by all this: still only what differs from the defaults.
    expect(sent(postMessage, (message) => message.kind === 'studio:sandbox:state').at(-1)?.state).toEqual({ filters: {} })
  })

  it('each card reports its primary query and what it actually draws, not the spec symbols', async () => {
    const postMessage = mockHostFrame()
    mountApp()
    await settle()

    expect(panelOf(postMessage, 'p0:verdict')).toMatchObject({ queryId: 'by_time', bind: { measure: 'orders' } })
    expect(panelOf(postMessage, 'p1:kpis')).toMatchObject({ queryId: 'totals', bind: { style: 'spark', measures: ['orders', 'revenue'] } })
    // `{ dims: 'all', limit: 12 }` in the spec: the checked dimensions and the rail's measure on screen.
    expect(panelOf(postMessage, 'p2:breakdown')?.queryId).toBe('by_dimension')
    expect(panelOf(postMessage, 'p2:breakdown')?.bind).toEqual({ dims: ['region', 'channel', 'category'], limit: 12, measure: 'orders' })
  })

  it('switching the measure, unchecking a dimension and picking a preset each reach the next context message', async () => {
    const postMessage = mockHostFrame()
    mountApp()
    await settle()

    // The rail's measure. The breakdown follows it; the verdict keeps judging the primary measure.
    act(() => {
      screen.getAllByRole('button', { name: 'Revenue' })[0]?.click()
    })
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.measure).toEqual({ id: 'revenue', column: 'revenue_total', label: 'Revenue' })
    expect(panelOf(postMessage, 'p2:breakdown')?.bind).toMatchObject({ measure: 'revenue' })
    expect(panelOf(postMessage, 'p0:verdict')?.bind).toEqual({ measure: 'orders' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Channel' }))
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.dimensions).toEqual([
      { field: 'region', label: 'Region' },
      { field: 'category', label: 'Category' },
    ])
    expect(panelOf(postMessage, 'p2:breakdown')?.bind).toMatchObject({ dims: ['region', 'category'] })

    // Checked again, it is back in spec order, whatever order the rail holds it in.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Channel' }))
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.dimensions?.map((dimension) => dimension.field)).toEqual(['region', 'channel', 'category'])

    act(() => {
      screen.getByRole('button', { name: 'Last 7 days' }).click()
    })
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.window).toEqual({ column: 'event_time', from: '2026-01-25', to: '2026-02-01', preset: '7d', grain: 'day', isDefault: false })
  })

  it('an injected asOf is in the scope, and the default window ends at it', async () => {
    const postMessage = mockHostFrame()
    injectState({ asOf: '2026-01-20' })
    mountApp()
    await settle()

    const scope = latestContext(postMessage).scope
    expect(scope?.asOf).toBe('2026-01-20')
    expect(scope?.window).toEqual({ column: 'event_time', from: '2025-12-21', to: '2026-01-20', preset: '30d', grain: 'day', isDefault: true })
  })

  it('a filter at "All" is omitted; a narrower pick is reported and is no longer the default', async () => {
    const postMessage = mockHostFrame()
    mountApp()
    await settle()
    // `category` starts at "All".
    expect(latestContext(postMessage).scope?.filters.map((filter) => filter.field)).toEqual(['region', 'channel'])

    const region = screen.getByRole('group', { name: 'Region' })
    act(() => {
      within(region).getByRole('button', { name: 'amer' }).click()
    })
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.filters[0]).toEqual({ field: 'region', label: 'Region', values: ['emea'], isDefault: false })

    act(() => {
      within(region).getByRole('button', { name: 'All' }).click()
    })
    await settle(NEXT_FRAME_MS)
    expect(latestContext(postMessage).scope?.filters).toEqual([{ field: 'channel', label: 'Channel', values: ['web'], isDefault: true }])
  })

  it('reports the picked entity, and posts nothing before a card is on the page', async () => {
    const postMessage = mockHostFrame()
    mountApp(WITH_ENTITY)
    await settle()
    // No entity yet, so no card: the scope alone is never a reason to post.
    expect(contextMessages(postMessage)).toEqual([])

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'st_0042' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await settle()

    expect(latestContext(postMessage).scope?.entity).toEqual({ field: 'store_id', value: 'st_0042', label: 'Store' })
  })

  it('an unchanged scope posts nothing', async () => {
    const postMessage = mockHostFrame()
    mountApp()
    await settle()
    const before = contextMessages(postMessage).length

    act(() => setPageScope(JSON.parse(JSON.stringify(UNTOUCHED)) as PageScope))
    await settle(NEXT_FRAME_MS)
    expect(contextMessages(postMessage).length).toBe(before)
  })
})

describe('pageScope', () => {
  const scopeOf = (spec: Spec, ui: { measure: string; dims: readonly string[] }, extra: { asOf?: string; entityId?: string } = {}) => {
    const applied = applyRenderState(spec, {})
    return pageScope({ spec, controls: { filters: applied.filters, time: applied.time, asOf: extra.asOf }, defaults: applied.defaults, ui, entityId: extra.entityId })
  }

  it('keeps every list and string inside what the host accepts, and leaves out a date that is not a real day', () => {
    const fields = Array.from({ length: 30 }, (_, index) => `dim_${index}`)
    const options = Array.from({ length: 150 }, (_, index) => `v${index}`)
    const long = 'x'.repeat(300)
    const spec: Spec = {
      ...EXPLORER,
      time: { from: '2026-02-31', to: '2026-03-01' },
      dimensions: fields.map((field) => ({ field, label: long })),
      entity: { field: 'store_id', label: 'Store', type: 'string' },
      controls: fields.map((dim) => ({ kind: 'filter' as const, dim, multi: true, options, default: options.slice(0, 120) })),
    }
    const scope = scopeOf(spec, { measure: 'orders', dims: fields }, { asOf: '2026-13-01', entityId: long })

    expect(scope.window).toBeUndefined()
    expect(scope.asOf).toBeUndefined()
    expect(scope.filters).toHaveLength(SCOPE_LIMITS.filters)
    for (const filter of scope.filters) {
      expect(filter.values).toHaveLength(SCOPE_LIMITS.values)
      expect(filter.label).toHaveLength(SCOPE_LIMITS.chars)
    }
    expect(scope.dimensions).toHaveLength(SCOPE_LIMITS.dimensions)
    expect(scope.entity?.value).toHaveLength(SCOPE_LIMITS.chars)
  })

  it('reports a filter that declares no options whenever it holds a value, and never one that holds none', () => {
    const spec: Spec = {
      ...EXPLORER,
      controls: [
        { kind: 'filter', dim: 'region', multi: true, default: ['emea'] },
        { kind: 'filter', dim: 'channel' },
      ],
    }
    const scope = scopeOf(spec, { measure: 'orders', dims: [] })
    expect(scope.filters).toEqual([{ field: 'region', label: 'Region', values: ['emea'], isDefault: true }])
    expect(scope.dimensions).toEqual([])
  })

  it('an ab_test spec reports its metric by id alone, and no period comparison', () => {
    const spec: Spec = {
      ...EXPLORER,
      family: { kind: 'ab_test', arms: { field: 'arm', control: 'DEFAULT' }, roles: { bookers: 'orders', orders: 'orders', value: 'revenue', participants: { arm: 'orders', control: 'orders', total: 'orders' } } },
    }
    const scope = scopeOf(spec, { measure: 'NIBPD', dims: ['region'] })
    expect(scope.measure).toEqual({ id: 'NIBPD' })
    expect(scope.compare).toBeUndefined()
  })
})
