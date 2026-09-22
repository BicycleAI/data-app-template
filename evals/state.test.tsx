/**
 * T9.0, "Schedule Mode — deep link + readiness": the four things the host
 * builds against.
 *
 * 1. Every panel in `studio:sandbox:context` carries a `status`, worst-of
 *    across the cards a recipe rendered for it.
 * 2. The host's `render` state (`window.__BDA_CONTEXT.state`) is adopted
 *    BEFORE the first query goes out — pinned here by reading the very first
 *    `studio:sandbox:query` off the wire and checking the filter slots and
 *    the pinned as-of are already in its parameters.
 * 3. What was adopted, and what had to be dropped, comes back as
 *    `studio:sandbox:state` — once at the start and again on every change.
 * 4. `snapshot` puts `kit-snapshot` on the document root and nothing else.
 *
 * Synthetic spec throughout — no real customer or model ids, per
 * `scripts/no-real-ids.sh`.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CORE } from '../runtime/src/App.js'
import { FilterBar } from '../runtime/src/chrome/FilterBar.js'
import { applyRenderState, ControlsProvider } from '../runtime/src/controls.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import { Widget } from '../runtime/src/parts.js'
import type { FilterControl, Spec } from '../runtime/src/spec.js'
import { PanelMetaProvider, resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'
import { initContext } from '../runtime/src/studio/context.js'
import { SNAPSHOT_CLASS } from '../runtime/src/studio/hostState.js'
import { createQueryClient } from '../runtime/src/studio/hooks.js'
import { BdaError, type BdaContext, type PanelStatus, type RenderState } from '../runtime/src/studio/types.js'
import { UiProvider } from '../runtime/src/ui.js'

/* ------------------------------------------------------------- fixtures */

/** Synthetic — no real model id, field or dimension name. */
const SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders' },
    { id: 'revenue', column: 'revenue', label: 'Revenue', format: 'currency', role: 'primary' },
  ],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
  ],
  panels: [{ recipe: 'trend', bind: {}, say: 'How is it moving?' }],
  questions: [],
  controls: [
    { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'], default: ['emea', 'amer'] },
    { kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'], default: 'web' },
    { kind: 'time', presets: ['7d', '30d', '90d'], default: '30d' },
  ],
}

const NOW = new Date('2026-09-16T12:00:00Z')

function ready<T>(rows: T): QueryState<T> {
  return { rows, isPending: false, isFetching: false, error: null, refetch: () => {} }
}

function pending<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

function failed<T>(): QueryState<T> {
  return { rows: undefined, isPending: false, isFetching: false, error: new BdaError('query_failed', 'the model is unavailable', 500), refetch: () => {} }
}

/** A `CoreData` whose `series` (what the `trend` recipe waits on) is in the given state. */
function coreWithSeries(series: QueryState<readonly { period: Date; values: Record<string, number | null> }[]>): CoreData {
  return {
    totals: ready({}),
    series: series as CoreData['series'],
    dims: ready([]),
    trendBy: () => pending(),
    slicesAt: () => [],
  }
}

const ONE_POINT = [{ period: new Date('2026-01-01T00:00:00Z'), values: { orders: 10, revenue: 100 } }]

/* ----------------------------------------------------------- host frame */

function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

function restoreHostFrame(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
}

type AnyMessage = Record<string, unknown>

function sent(postMessage: ReturnType<typeof vi.fn>, match: (message: AnyMessage) => boolean): AnyMessage[] {
  return postMessage.mock.calls.map((call) => call[0] as AnyMessage).filter((message) => message !== null && typeof message === 'object' && match(message))
}

const contextMessages = (post: ReturnType<typeof vi.fn>) => sent(post, (message) => message.type === 'studio:sandbox:context')
const stateMessages = (post: ReturnType<typeof vi.fn>) => sent(post, (message) => message.kind === 'studio:sandbox:state')
const queryMessages = (post: ReturnType<typeof vi.fn>) => sent(post, (message) => message.type === 'studio:sandbox:query')

/** The debounced (100ms) context report has had time to fire. */
async function settle(ms = 200): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/** What the host injected for this case. `renderState()` re-reads it every time, so a test may change it. */
function injectState(state: RenderState | undefined): void {
  const injected = window.__BDA_CONTEXT as BdaContext | undefined
  if (injected === undefined) throw new Error('no injected context')
  window.__BDA_CONTEXT = { ...injected, ...(state === undefined ? {} : { state }) }
  if (state === undefined) delete (window.__BDA_CONTEXT as { state?: RenderState }).state
}

beforeAll(async () => {
  window.__BDA_CONTEXT = { v: 1, appId: 'app_demo', version: 1, apiBase: '/api', token: 'tkn', expiresAt: '2099-01-01T00:00:00.000Z', theme: 'light', themePreference: 'light' }
  await initContext()
})

beforeEach(() => {
  injectState(undefined)
})

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  restoreHostFrame()
  document.documentElement.classList.remove(SNAPSHOT_CLASS)
  vi.restoreAllMocks()
})

/* ------------------------------------------ 1. panel status on every report */

function mountPanel(recipe: string, panelId: string, core: CoreData) {
  const Recipe = CORE[recipe]
  if (Recipe === undefined) throw new Error(`no such core recipe "${recipe}"`)
  return render(
    <UiProvider spec={SPEC}>
      <PanelMetaProvider value={{ panelId, recipe, say: 'How is it moving?', bind: {} }}>
        <Recipe spec={SPEC} core={core} bind={{}} />
      </PanelMetaProvider>
    </UiProvider>,
  )
}

/** The status of one panel in the most recent context report. */
function latestStatus(postMessage: ReturnType<typeof vi.fn>, panelId: string): PanelStatus | undefined {
  const messages = contextMessages(postMessage)
  const latest = messages[messages.length - 1]
  const panels = (latest?.panels ?? []) as { panelId: string; status: PanelStatus }[]
  return panels.find((panel) => panel.panelId === panelId)?.status
}

describe('contract 1 — every panel reports a status', () => {
  it('a panel whose query is still in flight reports loading', async () => {
    const postMessage = mockHostFrame()
    mountPanel('trend', 'p0:trend', coreWithSeries(pending()))
    await settle()
    expect(latestStatus(postMessage, 'p0:trend')).toBe('loading')
  })

  it('loading -> ready once the query resolves with rows', async () => {
    const postMessage = mockHostFrame()
    const { rerender } = mountPanel('trend', 'p0:trend', coreWithSeries(pending()))
    await settle()
    expect(latestStatus(postMessage, 'p0:trend')).toBe('loading')

    rerender(
      <UiProvider spec={SPEC}>
        <PanelMetaProvider value={{ panelId: 'p0:trend', recipe: 'trend', say: 'How is it moving?', bind: {} }}>
          {CORE.trend !== undefined ? <CORE.trend spec={SPEC} core={coreWithSeries(ready(ONE_POINT))} bind={{}} /> : null}
        </PanelMetaProvider>
      </UiProvider>,
    )
    await settle()
    expect(latestStatus(postMessage, 'p0:trend')).toBe('ready')
  })

  it('a query that resolved with zero rows reports empty, not ready', async () => {
    const postMessage = mockHostFrame()
    mountPanel('trend', 'p0:trend', coreWithSeries(ready([])))
    await settle()
    expect(latestStatus(postMessage, 'p0:trend')).toBe('empty')
  })

  it('a failed query reports error', async () => {
    const postMessage = mockHostFrame()
    mountPanel('trend', 'p0:trend', coreWithSeries(failed()))
    await settle()
    expect(latestStatus(postMessage, 'p0:trend')).toBe('error')
  })

  it('a status change re-reports even when the digest has not moved', async () => {
    const postMessage = mockHostFrame()
    const { rerender } = mountPanel('trend', 'p0:trend', coreWithSeries(pending()))
    await settle()
    const before = contextMessages(postMessage).length

    // Same (absent) digest either way — only the status moves.
    rerender(
      <UiProvider spec={SPEC}>
        <PanelMetaProvider value={{ panelId: 'p0:trend', recipe: 'trend', say: 'How is it moving?', bind: {} }}>
          {CORE.trend !== undefined ? <CORE.trend spec={SPEC} core={coreWithSeries(failed())} bind={{}} /> : null}
        </PanelMetaProvider>
      </UiProvider>,
    )
    await settle()
    expect(contextMessages(postMessage).length).toBeGreaterThan(before)
    expect(latestStatus(postMessage, 'p0:trend')).toBe('error')
  })

  describe('worst-of across the cards one recipe rendered for one panel', () => {
    /** Two cards, one panel id — exactly the shape `kpis` and `ranking` produce. */
    function mountTwoCards(left: Parameters<typeof Widget>[0], right: Parameters<typeof Widget>[0]) {
      return render(
        <UiProvider spec={SPEC}>
          <PanelMetaProvider value={{ panelId: 'p0:kpis', recipe: 'kpis', say: 'How big?', bind: {} }}>
            <Widget {...left} />
            <Widget {...right} />
          </PanelMetaProvider>
        </UiProvider>,
      )
    }

    const card = (props: Partial<Parameters<typeof Widget>[0]>): Parameters<typeof Widget>[0] => ({
      heading: <span>Card</span>,
      pending: false,
      skeleton: { kind: 'metric' },
      children: <span>body</span>,
      ...props,
    })

    it('ready + empty -> empty', async () => {
      const postMessage = mockHostFrame()
      mountTwoCards(card({}), card({ empty: true }))
      await settle()
      expect(latestStatus(postMessage, 'p0:kpis')).toBe('empty')
    })

    it('empty + loading -> loading', async () => {
      const postMessage = mockHostFrame()
      mountTwoCards(card({ empty: true }), card({ pending: true }))
      await settle()
      expect(latestStatus(postMessage, 'p0:kpis')).toBe('loading')
    })

    it('loading + error -> error', async () => {
      const postMessage = mockHostFrame()
      mountTwoCards(card({ pending: true }), card({ error: new BdaError('query_failed', 'nope', 500) }))
      await settle()
      expect(latestStatus(postMessage, 'p0:kpis')).toBe('error')
    })
  })
})

/* ------------------------------ 2. initial state, applied before the query */

describe('contract 2 — applyRenderState checks the host state against the spec', () => {
  it('adopts a filter selection and a declared preset', () => {
    const applied = applyRenderState(SPEC, { filters: { region: ['apac'] }, time: { preset: '7d' } }, NOW)
    expect(applied.filters).toEqual({ region: ['apac'], channel: ['web'] })
    expect(applied.time).toEqual({ from: '2026-01-25', to: '2026-02-01', preset: '7d' })
    expect(applied.dropped).toEqual([])
  })

  it('overrides the spec\'s own defaults rather than merging with them', () => {
    const applied = applyRenderState(SPEC, { filters: { region: ['emea', 'apac'] } }, NOW)
    expect(applied.filters.region).toEqual(['emea', 'apac'])
  })

  it('drops an unknown filter id and says so', () => {
    const applied = applyRenderState(SPEC, { filters: { market: ['emea'] } }, NOW)
    expect(applied.dropped).toEqual(['market: unknown filter'])
    // The spec's own seed survives untouched.
    expect(applied.filters).toEqual({ region: ['emea', 'amer'], channel: ['web'] })
  })

  it('drops a value the filter does not offer and says so', () => {
    const applied = applyRenderState(SPEC, { filters: { channel: ['Mars'] } }, NOW)
    expect(applied.dropped).toEqual(['channel=Mars: not an allowed value'])
    expect(applied.filters.channel).toEqual(['web'])
  })

  it('keeps the good values of a filter and drops only the bad ones', () => {
    const applied = applyRenderState(SPEC, { filters: { region: ['apac', 'Mars'] } }, NOW)
    expect(applied.filters.region).toEqual(['apac'])
    expect(applied.dropped).toEqual(['region=Mars: not an allowed value'])
  })

  it('a single-select filter takes the first value and reports the rest', () => {
    const applied = applyRenderState(SPEC, { filters: { channel: ['web', 'app'] } }, NOW)
    expect(applied.filters.channel).toEqual(['web'])
    expect(applied.dropped).toEqual(['channel=app: single-select takes one value'])
  })

  it('drops a preset the time control does not declare', () => {
    const applied = applyRenderState(SPEC, { time: { preset: 'ytd' } }, NOW)
    expect(applied.dropped).toEqual(['time.preset=ytd: not a declared preset'])
    expect(applied.time.preset).toBe('30d')
  })

  it('takes an explicit ISO range when no preset is given', () => {
    const applied = applyRenderState(SPEC, { time: { from: '2026-03-01', to: '2026-04-01' } }, NOW)
    expect(applied.time).toEqual({ from: '2026-03-01', to: '2026-04-01' })
    expect(applied.dropped).toEqual([])
  })

  it('drops a half-stated range', () => {
    const applied = applyRenderState(SPEC, { time: { from: '2026-03-01' } }, NOW)
    expect(applied.dropped).toEqual(['time=2026-03-01..: needs a valid ISO from and to'])
  })

  it('asOf pins the window: the upper bound never reaches past it', () => {
    const applied = applyRenderState(SPEC, { asOf: '2026-01-20', time: { from: '2026-01-01', to: '2026-02-01' } }, NOW)
    expect(applied.asOf).toBe('2026-01-20')
    expect(applied.time).toEqual({ from: '2026-01-01', to: '2026-01-20' })
  })

  it('drops an asOf that is not an ISO date', () => {
    const applied = applyRenderState(SPEC, { asOf: 'yesterday' }, NOW)
    expect(applied.asOf).toBeUndefined()
    expect(applied.dropped).toEqual(['asOf=yesterday: not an ISO date'])
  })

  it('carries a section through untouched', () => {
    expect(applyRenderState(SPEC, { section: 'growth' }, NOW).section).toBe('growth')
  })
})

describe('contract 2 — the first query already carries the host state', () => {
  it('the first studio:sandbox:query carries the host filter slots and the pinned as-of', async () => {
    const postMessage = mockHostFrame()
    injectState({ filters: { region: ['apac'] }, asOf: '2026-01-20', time: { from: '2026-01-01', to: '2026-02-01' } })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <App spec={SPEC} />
      </QueryClientProvider>,
    )
    await settle()

    const queries = queryMessages(postMessage)
    expect(queries.length, 'no query reached the host at all').toBeGreaterThan(0)

    const first = queries[0] as { queryId: string; options: { parameters: Record<string, unknown> } }
    const parameters = first.options.parameters
    // The host's pick, in the composer's fixed slots — not the spec's default (emea + amer).
    expect(parameters).toMatchObject({ region_0: 'apac', region_1: 'apac', region_2: 'apac', channel_0: 'web' })
    // The as-of, as the only upper bound any query is allowed to read to.
    expect(parameters.to).toBe('2026-01-20')
    expect(parameters.from).toBe('2026-01-01')
    // Nothing went out with the pre-state defaults first.
    for (const query of queries) {
      expect((query as { options: { parameters: Record<string, unknown> } }).options.parameters.to).toBe('2026-01-20')
    }
  })
})

/* ------------------------------------------------ 3. the state report back */

describe('contract 3 — studio:sandbox:state', () => {
  function mountBar(): void {
    render(
      <UiProvider spec={SPEC}>
        <ControlsProvider spec={SPEC}>
          <FilterBar spec={SPEC} />
        </ControlsProvider>
      </UiProvider>,
    )
  }

  it('is sent once with the applied state and the dropped list', async () => {
    const postMessage = mockHostFrame()
    injectState({ filters: { region: ['apac'], market: ['x'] }, asOf: '2026-01-20' })
    mountBar()
    await settle()

    const messages = stateMessages(postMessage)
    expect(messages.length).toBeGreaterThan(0)
    const first = messages[0] as { kind: string; state: { filters: Record<string, string[]>; asOf?: string; time?: { to: string } }; dropped: string[] }
    expect(first.kind).toBe('studio:sandbox:state')
    expect(first.state.filters).toEqual({ region: ['apac'], channel: ['web'] })
    expect(first.state.asOf).toBe('2026-01-20')
    expect(first.state.time?.to).toBe('2026-01-20')
    expect(first.dropped).toEqual(['market: unknown filter'])
  })

  it('is sent again when a person changes a filter in the FilterBar', async () => {
    const postMessage = mockHostFrame()
    mountBar()
    await settle()
    const before = stateMessages(postMessage).length

    act(() => {
      screen.getByRole('button', { name: 'apac' }).click()
    })
    await settle()

    const messages = stateMessages(postMessage)
    expect(messages.length).toBeGreaterThan(before)
    const latest = messages[messages.length - 1] as { state: { filters: Record<string, string[]> } }
    expect(latest.state.filters.region).toEqual(['emea', 'amer', 'apac'])
  })

  it('is sent again when a person changes the time preset', async () => {
    const postMessage = mockHostFrame()
    mountBar()
    await settle()

    act(() => {
      screen.getByRole('button', { name: 'Last 7 days' }).click()
    })
    await settle()

    const latest = stateMessages(postMessage).at(-1) as { state: { time?: { preset?: string } } } | undefined
    expect(latest?.state.time?.preset).toBe('7d')
  })

  it('is never sent while the frame is not embedded', async () => {
    restoreHostFrame()
    const postMessage = vi.fn()
    mountBar()
    await settle()
    expect(postMessage).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------ 4. snapshot */

describe('contract 4 — snapshot presentation', () => {
  function mountApp(): void {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <App spec={SPEC} />
      </QueryClientProvider>,
    )
  }

  it('puts kit-snapshot on the document root when the host asks for it', async () => {
    mockHostFrame()
    injectState({ snapshot: true })
    mountApp()
    await settle(0)
    expect(document.documentElement.classList.contains(SNAPSHOT_CLASS)).toBe(true)
  })

  it('leaves it off otherwise', async () => {
    mockHostFrame()
    injectState({})
    mountApp()
    await settle(0)
    expect(document.documentElement.classList.contains(SNAPSHOT_CLASS)).toBe(false)
  })

  it('still renders the filters — a capture has to show what was applied', async () => {
    mockHostFrame()
    injectState({ snapshot: true, filters: { region: ['apac'] } })
    mountApp()
    await settle(0)
    const chip = screen.getByRole('button', { name: 'apac' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })
})

/* ------------------------------------------------------------- guardrail */

describe('the spec fixture stays synthetic', () => {
  it('names no real model, and every filter dim is a declared dimension', () => {
    expect(SPEC.model.startsWith('m_')).toBe(true)
    for (const control of SPEC.controls ?? []) {
      if (control.kind !== 'filter') continue
      expect(SPEC.dimensions.some((dim) => dim.field === (control as FilterControl).dim)).toBe(true)
    }
  })
})
