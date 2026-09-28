/**
 * A filter's state can only be what its query can bind.
 *
 * The composer gives a single-select filter exactly one slot (`AND <dim> =
 * :<slug>_0`) and a multi filter at most `slots` (5 by default); a filter
 * with no `default` gets its first option(s) as the slots' defaults
 * (`compose/datasets.mjs`, `## Filters`). So a single-select filter with no
 * default is narrowed to its FIRST option, and a multi filter offering more
 * options than it has slots can never be at "All".
 *
 * The page used to seed both with every option. The chips then said "All"
 * (every chip pressed, and a note that the totals showed every value) while
 * `totals` and `by_time` bound the first option(s), and the breakdown —
 * narrowed in memory from the same state — kept every row. This pins the one
 * rule that makes them agree: the seed, the chips, the query parameters, the
 * in-memory narrowing and `studio:sandbox:state` all read the same state, and
 * that state never holds more picks than the query has slots.
 *
 * Synthetic spec throughout — no real model id, field or dimension name.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../runtime/src/App.js'
import { FilterBar } from '../runtime/src/chrome/FilterBar.js'
import { applyRenderState, buildFilterParams, ControlsProvider, filterRows, initialFilters } from '../runtime/src/controls.js'
import type { Spec } from '../runtime/src/spec.js'
import { resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'
import { initContext } from '../runtime/src/studio/context.js'
import { createQueryClient } from '../runtime/src/studio/hooks.js'
import type { BdaContext, RenderState } from '../runtime/src/studio/types.js'
import { UiProvider } from '../runtime/src/ui.js'

const REGIONS = ['emea', 'amer', 'apac', 'latam', 'anzu', 'nordics', 'benelux', 'dach']

const SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [{ id: 'orders', column: 'orders', label: 'Orders', role: 'primary' }],
  dimensions: [
    { field: 'channel', label: 'Channel' },
    { field: 'region', label: 'Region' },
  ],
  panels: [{ recipe: 'trend', bind: {}, say: 'How is it moving?' }],
  questions: [],
  controls: [
    // single-select, options, no default: one slot, bound to its first option.
    { kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'] },
    // multi, 8 options, no default: 5 slots, bound to the first five.
    { kind: 'filter', dim: 'region', multi: true, options: REGIONS },
  ],
}

/* ----------------------------------------------------------- host frame */

function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

type AnyMessage = Record<string, unknown>
const sent = (post: ReturnType<typeof vi.fn>, match: (message: AnyMessage) => boolean): AnyMessage[] =>
  post.mock.calls.map((call) => call[0] as AnyMessage).filter((message) => message !== null && typeof message === 'object' && match(message))
const stateMessages = (post: ReturnType<typeof vi.fn>) => sent(post, (message) => message.kind === 'studio:sandbox:state')
const queryMessages = (post: ReturnType<typeof vi.fn>) => sent(post, (message) => message.type === 'studio:sandbox:query')

async function settle(ms = 200): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function injectState(state: RenderState | undefined): void {
  const injected = window.__BDA_CONTEXT as BdaContext
  window.__BDA_CONTEXT = { ...injected, ...(state === undefined ? {} : { state }) }
  if (state === undefined) delete (window.__BDA_CONTEXT as { state?: RenderState }).state
}

beforeAll(async () => {
  window.__BDA_CONTEXT = { v: 1, appId: 'app_demo', version: 1, apiBase: '/api', token: 'tkn', expiresAt: '2099-01-01T00:00:00.000Z', theme: 'light', themePreference: 'light' }
  await initContext()
})

beforeEach(() => {
  resetRegistryForTests()
  injectState(undefined)
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
})

const pressed = (name: string): boolean => screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true'

function mountBar(spec: Spec = SPEC): void {
  render(
    <UiProvider spec={spec}>
      <ControlsProvider spec={spec}>
        <FilterBar spec={spec} />
      </ControlsProvider>
    </UiProvider>,
  )
}

/* ------------------------------------------------------------ the seed */

describe('the seed is what the query binds', () => {
  it('a single-select filter with no default starts on its first option, as its one slot does', () => {
    expect(initialFilters(SPEC).channel).toEqual(['web'])
    expect(buildFilterParams(SPEC, initialFilters(SPEC)).params).toMatchObject({ channel_0: 'web' })
  })

  it('a multi filter with more options than slots starts on the first five, as its slots do', () => {
    expect(initialFilters(SPEC).region).toEqual(REGIONS.slice(0, 5))
    expect(buildFilterParams(SPEC, initialFilters(SPEC)).params).toMatchObject({
      region_0: 'emea', region_1: 'amer', region_2: 'apac', region_3: 'latam', region_4: 'anzu',
    })
  })

  it('a multi filter with no more options than slots still starts on All', () => {
    const three: Spec = { ...SPEC, controls: [{ kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'] }] }
    expect(initialFilters(three).region).toEqual(['emea', 'amer', 'apac'])
  })

  it('the breakdown, narrowed in memory from the same state, keeps the same cut the totals bind', () => {
    const rows = [
      { channel: 'web', region: 'emea', orders: 1 },
      { channel: 'app', region: 'emea', orders: 2 },
      { channel: 'web', region: 'dach', orders: 3 },
    ]
    // `web` only (the one slot), and `dach` is not among the five regions bound.
    expect(filterRows(rows, initialFilters(SPEC))).toEqual([rows[0]])
  })
})

/* ----------------------------------------------------------- the chips */

describe('the chips say what the query binds', () => {
  it('shows only the first option pressed for a single-select filter with no default', async () => {
    mockHostFrame()
    mountBar()
    await settle()
    expect(pressed('web')).toBe(true)
    expect(pressed('app')).toBe(false)
    expect(pressed('store')).toBe(false)
  })

  it('never claims the totals show every value', async () => {
    mockHostFrame()
    mountBar()
    await settle()
    expect(screen.queryByText(/show all/i)).toBeNull()
  })

  it('offers no All chip where the slots cannot hold every option, and says how many can be picked', async () => {
    mockHostFrame()
    mountBar()
    await settle()
    expect(screen.queryAllByRole('button', { name: 'All' })).toHaveLength(0)
    expect(screen.getByText(/pick up to 5/i)).toBeTruthy()
  })

  it('does not take a sixth pick into five slots', async () => {
    const postMessage = mockHostFrame()
    mountBar()
    await settle()
    const nordics = screen.getByRole('button', { name: 'nordics' })
    expect((nordics as HTMLButtonElement).disabled).toBe(true)
    act(() => nordics.click())
    await settle()
    expect(pressed('nordics')).toBe(false)
    // Still untouched: nothing moved, so nothing differs from the defaults.
    expect((stateMessages(postMessage).at(-1) as { state: unknown }).state).toEqual({ filters: {} })
  })

  it('makes room by unpicking one first', async () => {
    const postMessage = mockHostFrame()
    mountBar()
    await settle()
    act(() => screen.getByRole('button', { name: 'anzu' }).click())
    await settle()
    act(() => screen.getByRole('button', { name: 'nordics' }).click())
    await settle()
    const latest = stateMessages(postMessage).at(-1) as { state: { filters: Record<string, string[]> } }
    expect(latest.state.filters).toEqual({ region: ['emea', 'amer', 'apac', 'latam', 'nordics'] })
  })
})

/* ----------------------------------------------- the page, end to end */

describe('the page agrees with its queries', () => {
  it('an untouched page binds the first option, shows it, and reports nothing changed', async () => {
    const postMessage = mockHostFrame()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <App spec={SPEC} />
      </QueryClientProvider>,
    )
    await settle()

    const totals = queryMessages(postMessage).find((query) => query.queryId === 'totals') as { options: { parameters: Record<string, unknown> } }
    expect(totals.options.parameters).toMatchObject({ channel_0: 'web', region_0: 'emea', region_4: 'anzu' })
    expect(pressed('web') && !pressed('app') && !pressed('store')).toBe(true)
    expect(stateMessages(postMessage)[0]).toEqual({ kind: 'studio:sandbox:state', state: { filters: {} }, dropped: [] })
  })

  it('a link naming more values than a filter has slots keeps the first ones and says it dropped the rest', () => {
    const applied = applyRenderState(SPEC, { filters: { region: REGIONS.slice(0, 7) } })
    expect(applied.filters.region).toEqual(REGIONS.slice(0, 5))
    expect(applied.dropped).toEqual([{ id: 'f.region', reason: 'invalid_value' }])
  })
})
