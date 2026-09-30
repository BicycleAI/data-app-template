/**
 * The page outline: what the page is, for the host's chat — its controls in
 * screen order with what each one offers, and its panels
 * (`runtime/src/studio/outline.ts`).
 *
 * The first case is the fixture agent-service tests its port of the same
 * mapping (`outline_from_spec`) against: both must build exactly this
 * outline from exactly this spec, so neither changes it alone. The rest pin
 * the mapping's edges, the caps, and that the outline rides on
 * `studio:sandbox:context` from the first report and is posted again only
 * when it changes.
 *
 * Synthetic spec throughout — no real customer or model ids, per
 * `scripts/no-real-ids.sh`.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../runtime/src/App.js'
import type { ControlSpec, Spec } from '../runtime/src/spec.js'
import { initContext } from '../runtime/src/studio/context.js'
import { resetRegistryForTests, setPageOutline } from '../runtime/src/studio/contextRegistry.js'
import { createQueryClient } from '../runtime/src/studio/hooks.js'
import { OUTLINE_LIMITS, type OutlineControl, type PageOutline, pageOutline } from '../runtime/src/studio/outline.js'
import type { QueryResult } from '../runtime/src/studio/types.js'

/* --------------------------------------------------------- shared fixture */

/** The contract's fixture spec, as agent-service has it too. */
const FIXTURE: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo explorer',
  decision: 'Which channels and regions move orders.',
  persona: 'analyst',
  template: 'explorer',
  time: { column: 'event_time', from: '2026-01-01', to: '2026-04-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders', role: 'primary' },
    { id: 'revenue', column: 'revenue', label: 'Revenue' },
  ],
  dimensions: [
    { field: 'channel', label: 'Channel' },
    { field: 'region', label: 'Region' },
  ],
  questions: [],
  controls: [
    { kind: 'measure' },
    { kind: 'depth' },
    { kind: 'dimensions' },
    { kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'] },
    { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac', 'latam', 'anzu', 'nordics', 'benelux', 'dach'] },
    { kind: 'time', presets: ['7d', '30d', '90d', 'ytd'], default: '30d' },
  ],
  panels: [
    { recipe: 'kpis', bind: {}, say: 'How big is each number?' },
    { recipe: 'trend', bind: {}, say: 'How is it moving?', explain: 'Line charts over time for each measure.' },
    { recipe: 'breakdown', bind: { dims: ['channel'] }, say: 'Which channels carry the orders?' },
  ],
}

/** The contract's "Expected outline" for `FIXTURE`. */
const EXPECTED: PageOutline = {
  title: 'Demo explorer',
  description: 'Which channels and regions move orders.',
  controls: [
    {
      id: 'measure',
      kind: 'measure',
      label: 'Measure',
      options: [
        { value: 'orders', label: 'Orders' },
        { value: 'revenue', label: 'Revenue' },
      ],
      default: ['orders'],
    },
    {
      id: 'depth',
      kind: 'select',
      label: 'Combine',
      options: [
        { value: '1', label: '1-way' },
        { value: '2', label: '2-way' },
        { value: '3', label: '3-way' },
      ],
      default: ['3'],
    },
    {
      id: 'dimensions',
      kind: 'dimensions',
      label: 'Dimensions',
      options: [
        { value: 'channel', label: 'Channel' },
        { value: 'region', label: 'Region' },
      ],
      multi: true,
      default: ['channel', 'region'],
    },
    { id: 'filter.channel', kind: 'filter', label: 'Channel', options: [{ value: 'web' }, { value: 'app' }, { value: 'store' }], default: ['web'] },
    {
      id: 'filter.region',
      kind: 'filter',
      label: 'Region',
      options: [{ value: 'emea' }, { value: 'amer' }, { value: 'apac' }, { value: 'latam' }, { value: 'anzu' }, { value: 'nordics' }, { value: 'benelux' }, { value: 'dach' }],
      multi: true,
      maxPicks: 5,
      default: ['emea', 'amer', 'apac', 'latam', 'anzu'],
    },
    {
      id: 'time',
      kind: 'dateRange',
      label: 'Time',
      options: [
        { value: '7d', label: 'Last 7 days' },
        { value: '30d', label: 'Last 30 days' },
        { value: '90d', label: 'Last 90 days' },
        { value: 'ytd', label: 'Year to date' },
      ],
      default: ['30d'],
    },
  ],
  panels: [
    { panelId: 'p0:kpis', title: 'How big is each number?', kind: 'kpis' },
    { panelId: 'p1:trend', title: 'How is it moving?', kind: 'trend', explain: 'Line charts over time for each measure.' },
    { panelId: 'p2:breakdown', title: 'Which channels carry the orders?', kind: 'breakdown' },
  ],
}

/* ------------------------------------------------------------- mapping */

/** A page with no controls, which each case below gives one or two. */
const BARE: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-04-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders', role: 'primary' },
    { id: 'revenue', column: 'revenue', label: 'Revenue' },
  ],
  dimensions: [
    { field: 'channel', label: 'Channel' },
    { field: 'region', label: 'Region' },
    { field: 'category', label: 'Category' },
  ],
  questions: [],
  controls: [],
  panels: [{ recipe: 'kpis', bind: {}, say: 'How big is each number?' }],
}

const WITH_ENTITY: Spec = {
  ...BARE,
  entity: { field: 'store_id', label: 'Store', type: 'string', list: { label: 'store_name', rank: 'orders' } },
  controls: [{ kind: 'entity' }],
}

const AB_FAMILY: NonNullable<Spec['family']> = {
  kind: 'ab_test',
  arms: { field: 'arm', control: 'DEFAULT' },
  roles: { bookers: 'orders', orders: 'orders', value: 'revenue', participants: { arm: 'orders', control: 'orders', total: 'orders' } },
}

const controlsOf = (spec: Spec): readonly OutlineControl[] => pageOutline({ spec }).controls
const withControls = (...controls: ControlSpec[]): Spec => ({ ...BARE, controls })

describe('pageOutline', () => {
  it('builds exactly the outline agent-service expects from the shared fixture', () => {
    expect(pageOutline({ spec: FIXTURE })).toStrictEqual(EXPECTED)
  })

  it('a page with no controls says so with an empty list, and has no description without a decision', () => {
    const outline = { title: 'Demo report', controls: [], panels: [{ panelId: 'p0:kpis', title: 'How big is each number?', kind: 'kpis' }] }
    expect(pageOutline({ spec: BARE })).toStrictEqual(outline)
    const { controls: _none, ...undeclared } = BARE
    expect(pageOutline({ spec: undeclared })).toStrictEqual(outline)
  })

  it('panels come from the questions when the spec resolved none, and a panel that says nothing is titled by its recipe', () => {
    const { panels: _resolved, ...unresolved } = BARE
    const spec: Spec = { ...unresolved, questions: [{ say: 'Which region leads?', recipe: 'ranking', bind: { dim: 'region' } }] }
    expect(pageOutline({ spec }).panels).toStrictEqual([{ panelId: 'p0:ranking', title: 'Which region leads?', kind: 'ranking' }])
    expect(pageOutline({ spec: { ...BARE, panels: [{ recipe: 'table', bind: {} }] } }).panels).toStrictEqual([{ panelId: 'p0:table', title: 'table', kind: 'table' }])
  })

  it('a time control without presets offers the three short ones, labelled as on screen, and has a default only when it declares one', () => {
    expect(controlsOf(withControls({ kind: 'time' }))).toStrictEqual([
      {
        id: 'time',
        kind: 'dateRange',
        label: 'Time',
        options: [
          { value: '7d', label: 'Last 7 days' },
          { value: '30d', label: 'Last 30 days' },
          { value: '90d', label: 'Last 90 days' },
        ],
      },
    ])
    expect(controlsOf(withControls({ kind: 'time', presets: ['quarter', 'ytd'], default: 'ytd' }))[0]).toStrictEqual({
      id: 'time',
      kind: 'dateRange',
      label: 'Time',
      options: [
        { value: 'quarter', label: 'This quarter' },
        { value: 'ytd', label: 'Year to date' },
      ],
      default: ['ytd'],
    })
  })

  it('a filter that declares no options lists none, and starts on what it holds', () => {
    expect(controlsOf(withControls({ kind: 'filter', dim: 'region' }, { kind: 'filter', dim: 'store_type', multi: true, default: ['outlet'] }))).toStrictEqual([
      { id: 'filter.region', kind: 'filter', label: 'Region', default: [] },
      // A field the spec does not declare as a dimension is labelled by itself, as the FilterBar does.
      { id: 'filter.store_type', kind: 'filter', label: 'store_type', multi: true, maxPicks: 1, default: ['outlet'] },
    ])
    expect(controlsOf(withControls({ kind: 'filter', dim: 'region', options: [] }))[0]).toStrictEqual({ id: 'filter.region', kind: 'filter', label: 'Region', default: [] })
  })

  it('a single-select filter starts on its default, else on its first option: its one slot holds one value', () => {
    expect(controlsOf(withControls({ kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'] }))[0]?.default).toEqual(['web'])
    expect(controlsOf(withControls({ kind: 'filter', dim: 'channel', options: ['web', 'app', 'store'], default: 'app' }))[0]).toStrictEqual({
      id: 'filter.channel',
      kind: 'filter',
      label: 'Channel',
      options: [{ value: 'web' }, { value: 'app' }, { value: 'store' }],
      default: ['app'],
    })
  })

  it('a multi filter takes at most its slots: all of a short list to start, the first of a long one, or its own `slots`', () => {
    const regions = ['emea', 'amer', 'apac', 'latam', 'anzu', 'nordics', 'benelux', 'dach']
    const [short, long, slotted, defaulted] = controlsOf(
      withControls(
        { kind: 'filter', dim: 'category', multi: true, options: ['toys', 'books'] },
        { kind: 'filter', dim: 'region', multi: true, options: regions },
        { kind: 'filter', dim: 'channel', multi: true, options: regions, slots: 3 },
        { kind: 'filter', dim: 'store_type', multi: true, options: regions, default: ['amer', 'dach'] },
      ),
    )
    expect(short).toMatchObject({ multi: true, maxPicks: 2, default: ['toys', 'books'] })
    expect(long).toMatchObject({ multi: true, maxPicks: 5, default: regions.slice(0, 5) })
    expect(slotted).toMatchObject({ multi: true, maxPicks: 3, default: regions.slice(0, 3) })
    expect(defaulted).toMatchObject({ multi: true, maxPicks: 5, default: ['amer', 'dach'] })
    expect(long?.options).toHaveLength(8)
  })

  it('a measure control with one option draws nothing, so the outline has none', () => {
    expect(controlsOf({ ...withControls({ kind: 'measure' }), measures: [{ id: 'orders', column: 'orders', label: 'Orders' }] })).toEqual([])
    expect(controlsOf(withControls({ kind: 'measure', options: ['orders'] }))).toEqual([])
  })

  it('the measure is labelled by the words, and starts on the first option when its default is not one', () => {
    const spec: Spec = { ...withControls({ kind: 'measure', options: ['revenue', 'orders'], default: 'refunds' }), words: { revenue: 'Net revenue' } }
    expect(controlsOf(spec)[0]).toStrictEqual({
      id: 'measure',
      kind: 'measure',
      label: 'Measure',
      options: [
        { value: 'revenue', label: 'Net revenue' },
        { value: 'orders', label: 'Orders' },
      ],
      default: ['revenue'],
    })
  })

  it('an ab_test page offers its derived metrics, labelled by its words, and starts on NIBPD', () => {
    const spec: Spec = { ...withControls({ kind: 'measure' }), family: AB_FAMILY, words: { NIBPD: 'Net income per booker', NICPD: 'Net income per customer' } }
    expect(controlsOf(spec)).toStrictEqual([
      {
        id: 'measure',
        kind: 'measure',
        label: 'Measure',
        options: [
          { value: 'NIBPD', label: 'Net income per booker' },
          { value: 'NIBrPD', label: 'NIBrPD' },
          { value: 'NICPD', label: 'Net income per customer' },
        ],
        default: ['NIBPD'],
      },
    ])
  })

  it('depth offers its own options when it names them, and starts on its default', () => {
    expect(controlsOf(withControls({ kind: 'depth', options: [2, 3], default: 2 }))).toStrictEqual([
      {
        id: 'depth',
        kind: 'select',
        label: 'Combine',
        options: [
          { value: '2', label: '2-way' },
          { value: '3', label: '3-way' },
        ],
        default: ['2'],
      },
    ])
  })

  it('the heatmap axes sit in the first heatmap panel, and are there only when the page has one', () => {
    const dims = [
      { value: 'channel', label: 'Channel' },
      { value: 'region', label: 'Region' },
      { value: 'category', label: 'Category' },
    ]
    const heatmap: Spec = {
      ...withControls({ kind: 'heatmap_axes' }),
      panels: [
        { recipe: 'kpis', bind: {} },
        { recipe: 'heatmap', bind: {} },
        { recipe: 'heatmap', bind: {} },
      ],
    }
    expect(controlsOf(heatmap)).toStrictEqual([
      { id: 'heatmap.rows', kind: 'select', label: 'Rows', options: dims, default: ['region'], panelId: 'p1:heatmap' },
      { id: 'heatmap.cols', kind: 'select', label: 'Columns', options: dims, default: ['category'], panelId: 'p1:heatmap' },
    ])
    // Two dimensions: the columns start on the first, as `UiProvider` does.
    expect(controlsOf({ ...heatmap, dimensions: BARE.dimensions.slice(0, 2) }).map((axis) => axis.default)).toEqual([['region'], ['channel']])
    expect(controlsOf(withControls({ kind: 'heatmap_axes' }))).toEqual([])
    expect(controlsOf({ ...heatmap, dimensions: BARE.dimensions.slice(0, 1) })).toEqual([])
  })

  it('an entity control lists no options until the list loads, then the first 100 and how many there are', () => {
    expect(controlsOf(WITH_ENTITY)).toStrictEqual([{ id: 'entity', kind: 'entity', label: 'Store' }])

    const entities = Array.from({ length: 150 }, (_, index) => ({ id: `st_${String(index).padStart(4, '0')}`, label: `Store ${index}` }))
    const [picker] = pageOutline({ spec: WITH_ENTITY, entities }).controls
    expect(picker?.options).toHaveLength(OUTLINE_LIMITS.options)
    expect(picker?.options?.[0]).toEqual({ value: 'st_0000', label: 'Store 0' })
    expect(picker?.optionCount).toBe(150)
    expect(pageOutline({ spec: WITH_ENTITY, entities: entities.slice(0, 2) }).controls[0]).toStrictEqual({
      id: 'entity',
      kind: 'entity',
      label: 'Store',
      options: [
        { value: 'st_0000', label: 'Store 0' },
        { value: 'st_0001', label: 'Store 1' },
      ],
      optionCount: 2,
    })
    expect(pageOutline({ spec: WITH_ENTITY, entities: [] }).controls[0]).toStrictEqual({ id: 'entity', kind: 'entity', label: 'Store', options: [], optionCount: 0 })

    // An entity with no picker declared draws none, and a picker with no entity has nothing to pick.
    expect(pageOutline({ spec: { ...WITH_ENTITY, controls: [] }, entities }).controls).toEqual([])
    expect(controlsOf(withControls({ kind: 'entity' }))).toEqual([])
  })

  it('lists the controls in the order both chromes draw them, whatever order the spec declares them in, and nothing for `variant` or `grain`', () => {
    const spec: Spec = {
      ...WITH_ENTITY,
      controls: [
        { kind: 'time' },
        { kind: 'filter', dim: 'region', options: ['emea', 'amer'] },
        { kind: 'heatmap_axes' },
        { kind: 'variant' },
        { kind: 'dimensions' },
        { kind: 'filter', dim: 'channel', options: ['web', 'app'] },
        { kind: 'grain' },
        { kind: 'depth' },
        { kind: 'measure' },
        { kind: 'entity' },
      ],
      panels: [{ recipe: 'heatmap', bind: {} }],
    }
    expect(controlsOf(spec).map((item) => item.id)).toEqual(['entity', 'measure', 'depth', 'dimensions', 'filter.region', 'filter.channel', 'time', 'heatmap.rows', 'heatmap.cols'])
  })

  it('keeps every list and string inside the caps, and says how many options a cut list had', () => {
    const long = 'x'.repeat(1500)
    const values = Array.from({ length: 150 }, (_, index) => `${index}_${'v'.repeat(300)}`)
    const fields = Array.from({ length: 30 }, (_, index) => `dim_${index}`)
    const spec: Spec = {
      ...BARE,
      title: long,
      decision: long,
      dimensions: fields.map((field) => ({ field, label: long })),
      controls: fields.map((dim) => ({ kind: 'filter' as const, dim, multi: true, options: values })),
      panels: Array.from({ length: 60 }, () => ({ recipe: 'r'.repeat(200), bind: {}, say: long, explain: long })),
    }
    const outline = pageOutline({ spec })

    expect(outline.title).toHaveLength(OUTLINE_LIMITS.chars)
    expect(outline.description).toHaveLength(OUTLINE_LIMITS.longChars)
    expect(outline.controls).toHaveLength(OUTLINE_LIMITS.controls)
    const [first] = outline.controls
    expect(first?.label).toHaveLength(OUTLINE_LIMITS.chars)
    expect(first?.options).toHaveLength(OUTLINE_LIMITS.options)
    expect(first?.optionCount).toBe(150)
    expect(first?.options?.[0]?.value).toHaveLength(OUTLINE_LIMITS.chars)
    expect(first?.default).toHaveLength(5)
    for (const value of first?.default ?? []) expect(value).toHaveLength(OUTLINE_LIMITS.chars)

    expect(outline.panels).toHaveLength(OUTLINE_LIMITS.panels)
    const panel = outline.panels?.[47]
    expect(panel?.panelId).toHaveLength(OUTLINE_LIMITS.panelIdChars)
    expect(panel?.panelId.startsWith('p47:')).toBe(true)
    expect(panel?.title).toHaveLength(OUTLINE_LIMITS.chars)
    expect(panel?.kind).toHaveLength(OUTLINE_LIMITS.kindChars)
    expect(panel?.explain).toHaveLength(OUTLINE_LIMITS.longChars)

    // A count past what the host accepts is capped too.
    const huge: { id: string; label: string }[] = new Array(OUTLINE_LIMITS.optionCount + 1)
    for (let index = 0; index < 100; index += 1) huge[index] = { id: `st_${index}`, label: `Store ${index}` }
    expect(pageOutline({ spec: WITH_ENTITY, entities: huge }).controls[0]?.optionCount).toBe(OUTLINE_LIMITS.optionCount)
  })
})

/* ------------------------------------------------ on studio:sandbox:context */

/** A fake host frame: makes `window.parent !== window` true, and captures every `postMessage`. */
function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

function restoreHostFrame(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
}

type Message = Record<string, unknown>

function sent(postMessage: ReturnType<typeof vi.fn>, match: (message: Message) => boolean): Message[] {
  return postMessage.mock.calls.map((call) => call[0] as Message).filter((message) => message !== null && typeof message === 'object' && match(message))
}

function contextMessages(postMessage: ReturnType<typeof vi.fn>): { outline?: PageOutline }[] {
  return sent(postMessage, (message) => message.type === 'studio:sandbox:context')
}

function entityListQueries(postMessage: ReturnType<typeof vi.fn>): Message[] {
  return sent(postMessage, (message) => message.type === 'studio:sandbox:query' && message.queryId === 'entity_list')
}

/** The host's answer to one query, the way `studio/client.ts` waits for it. */
function answer(requestId: string, result: QueryResult): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:query-result', requestId, ok: true, result } }))
  })
}

function mountApp(spec: Spec) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <App spec={spec} />
    </QueryClientProvider>,
  )
}

/** The debounced (100ms) or rAF-throttled report has had time to fire. */
async function settle(ms = 200): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/** Well inside the 100ms registry debounce: only the next-frame report can have gone out. */
const NEXT_FRAME_MS = 30

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  restoreHostFrame()
  vi.restoreAllMocks()
})

describe('the page outline on studio:sandbox:context', () => {
  beforeAll(async () => {
    // The whole app issues queries, which need an app identity; the embed page would inject this.
    window.__BDA_CONTEXT = { v: 1, appId: 'app_demo', version: 1, apiBase: '/api', token: 'tkn', expiresAt: '2099-01-01T00:00:00.000Z', theme: 'light', themePreference: 'light' }
    await initContext()
  })

  it('the first report already carries the outline the app was composed with, and a spec without an entity asks for no entity list', async () => {
    const postMessage = mockHostFrame()
    mountApp(FIXTURE)
    await settle()

    const messages = contextMessages(postMessage)
    expect(messages[0]?.outline).toStrictEqual(EXPECTED)
    expect(messages.at(-1)?.outline).toStrictEqual(EXPECTED)
    expect(entityListQueries(postMessage)).toEqual([])
  })

  it('an identical outline is not posted again; a changed one is, on the next frame', async () => {
    const postMessage = mockHostFrame()
    mountApp(FIXTURE)
    await settle()
    const before = contextMessages(postMessage).length

    act(() => setPageOutline(JSON.parse(JSON.stringify(EXPECTED)) as PageOutline))
    await settle(NEXT_FRAME_MS)
    expect(contextMessages(postMessage)).toHaveLength(before)

    const renamed: PageOutline = { ...EXPECTED, title: 'Demo explorer, renamed' }
    act(() => setPageOutline(renamed))
    await settle(NEXT_FRAME_MS)
    expect(contextMessages(postMessage).length).toBeGreaterThan(before)
    expect(contextMessages(postMessage).at(-1)?.outline).toStrictEqual(renamed)
  })

  it('an entity page lists the entities once the list lands, from the one entity_list query its picker runs too', async () => {
    const postMessage = mockHostFrame()
    mountApp({ ...WITH_ENTITY, template: 'explorer', chrome: 'explorer' })
    await settle(50)

    const queries = entityListQueries(postMessage)
    expect(queries).toHaveLength(1)
    answer(String(queries[0]?.requestId), {
      columns: [
        { name: 'store_id', type: 'string' },
        { name: 'store_name', type: 'string' },
        { name: 'orders', type: 'number' },
      ],
      rows: [
        ['st_0001', 'North store', 10],
        ['st_0002', 'South store', 30],
        ['st_0003', 'East store', 20],
      ],
      meta: { rowCount: 3, truncated: false },
    })
    await settle(50)

    // No card is on the page until a store is picked, so nothing has been posted yet.
    expect(contextMessages(postMessage)).toEqual([])
    const [store] = screen.getAllByRole('button', { name: /South store/ })
    if (store !== undefined) fireEvent.click(store)
    await settle()

    expect(contextMessages(postMessage).at(-1)?.outline?.controls[0]).toStrictEqual({
      id: 'entity',
      kind: 'entity',
      label: 'Store',
      // In the picker's order: by rank, highest first.
      options: [
        { value: 'st_0002', label: 'South store' },
        { value: 'st_0003', label: 'East store' },
        { value: 'st_0001', label: 'North store' },
      ],
      optionCount: 3,
    })
    expect(entityListQueries(postMessage)).toHaveLength(1)
  })
})
