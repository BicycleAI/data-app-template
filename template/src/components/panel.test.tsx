/**
 * What a `<Panel>` tells the host's chat, and what a `<Chart>` inside one adds.
 * Then the page as a whole: the scope it is set to, and the outline its
 * controls and page info describe.
 *
 * The host is a stand-in `window.parent` that records what it is sent: the
 * frame reports by posting to its parent, and only when it has one, so the
 * test gives it one. Timers are faked because the registry debounces its
 * reports (100 ms) and measures after paint (rAF).
 */

import * as Plot from '@observablehq/plot'
import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type OutlineControl,
  type PageOutline,
  type PageScope,
  registerControl,
  setPageInfo,
  setPageScope,
  unregisterControl,
} from '../studio/contextRegistry.js'
import { Chart, pointSelection } from './Chart.js'
import { Panel, digestOf } from './Panel.js'
import { useReportControl } from './useReportControl.js'

type Report = { panelId: string; recipe: string; say?: string; queryId?: string; digest?: unknown; selection?: unknown }

const sent: Array<{ type: string; panels: Report[]; scope?: PageScope; outline?: PageOutline }> = []
const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

const latest = (): Report[] => {
  const contexts = sent.filter((message) => message.type === 'studio:sandbox:context')
  return contexts[contexts.length - 1]?.panels ?? []
}

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sent.length = 0
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: (message: { type: string; panels: Report[] }) => sent.push(message) },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (realParent) Object.defineProperty(window, 'parent', realParent)
})

describe('digestOf', () => {
  it('sends the first rows as plain JSON, and nothing for no rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, i + 1)), n: i, fn: () => i }))
    const digest = digestOf(rows) as Array<Record<string, unknown>>
    expect(digest).toHaveLength(20)
    expect(digest[0]).toEqual({ at: '2026-01-01T00:00:00.000Z', n: 0 })
    expect(digestOf([])).toBeUndefined()
    expect(digestOf(undefined)).toBeUndefined()
  })
})

describe('pointSelection', () => {
  it('names a datum by its first two fields unless told how', () => {
    const datum = { month: new Date(Date.UTC(2025, 2, 1)), revenue: 142_000, cups: 9 }
    expect(pointSelection(datum)).toEqual({
      kind: 'point',
      label: expect.stringMatching(/^2025-03-01 · 142K$/),
      datum: { month: '2025-03-01T00:00:00.000Z', revenue: 142_000, cups: 9 },
    })
    expect(pointSelection(datum, () => 'Mar 2025 · $142K')?.label).toBe('Mar 2025 · $142K')
  })

  it('falls back when the label throws, and has nothing for what is not a row', () => {
    const label = () => {
      throw new Error('bad label')
    }
    expect(pointSelection({ state: 'TX', revenue: 5 }, label)?.label).toBe('TX · 5')
    expect(pointSelection([1, 2])).toBeUndefined()
    expect(pointSelection({})).toBeUndefined()
  })
})

describe('Panel', () => {
  it('reports the card to the host with what the chat needs, and stops when it unmounts', async () => {
    const rows = [{ state: 'TX', revenue: 5.9 }]
    const view = render(
      <Panel id="by_state" title="Revenue by state" kind="bar" queryId="revenue_by_state" rows={rows}>
        <h2>Revenue by state</h2>
      </Panel>,
    )
    await flush()

    expect(latest()).toEqual([
      expect.objectContaining({
        panelId: 'by_state',
        recipe: 'bar',
        say: 'Revenue by state',
        queryId: 'revenue_by_state',
        digest: [{ state: 'TX', revenue: 5.9 }],
      }),
    ])
    expect(view.container.querySelector('.bda-card')?.getAttribute('data-bda-panel')).toBe('by_state')

    view.unmount()
    await flush()
    expect(latest()).toEqual([])
  })

  it('highlights itself when the host points at it', async () => {
    const view = render(<Panel id="p1" title="One" />)
    await flush()

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:highlight', panelId: 'p1' } }))
    })
    const card = view.container.querySelector('.bda-card') as HTMLElement
    expect(card.classList.contains('bda-card--highlight')).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(card.classList.contains('bda-card--highlight')).toBe(false)
  })

  it('is not a card when told so, for a group of metrics', () => {
    const view = render(<Panel id="kpis" title="Headline" card={false} as="section" className="metrics" />)
    expect(view.container.querySelector('section')?.className).toBe('metrics')
  })
})

describe('Chart inside a Panel', () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 })
  })

  afterEach(() => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
  })

  it('reports the datum under the pointer as the panel’s point, and keeps it when the pointer leaves', async () => {
    const rows = [
      { state: 'TX', revenue: 5_900_000 },
      { state: 'IL', revenue: 1_600_000 },
    ]
    const options = { marks: [Plot.barY(rows, { x: 'state', y: 'revenue', tip: true })] }
    const view = render(
      <Panel id="by_state" title="Revenue by state">
        <Chart options={options} pointLabel={(d) => `${String(d.state)} · $${Number(d.revenue) / 1e6}M`} />
      </Panel>,
    )
    await flush()

    const figure = view.container.querySelector('.bda-chart > *') as (Element & { value?: unknown }) | null
    expect(figure).not.toBeNull()

    await act(async () => {
      ;(figure as Element & { value?: unknown }).value = rows[0]
      figure?.dispatchEvent(new Event('input'))
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(latest()[0]?.selection).toEqual({ kind: 'point', label: 'TX · $5.9M', datum: rows[0] })

    await act(async () => {
      ;(figure as Element & { value?: unknown }).value = null
      figure?.dispatchEvent(new Event('input'))
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(latest()[0]?.selection).toEqual({ kind: 'point', label: 'TX · $5.9M', datum: rows[0] })
  })

  it('reports nothing about points outside a Panel', async () => {
    const rows = [{ state: 'TX', revenue: 1 }]
    const view = render(<Chart options={{ marks: [Plot.barY(rows, { x: 'state', y: 'revenue', tip: true })] }} />)
    await flush()
    const figure = view.container.querySelector('.bda-chart > *') as Element & { value?: unknown }
    await act(async () => {
      figure.value = rows[0]
      figure.dispatchEvent(new Event('input'))
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(sent).toEqual([])
  })
})

describe('setPageScope', () => {
  const SCOPE: PageScope = {
    complete: true,
    model: 'm_retail_demo',
    window: { column: 'event_time', from: '2026-01-01', to: '2026-02-01', isDefault: true },
    filters: [{ field: 'channel', label: 'Channel', values: ['online'], isDefault: false }],
    measure: { id: 'revenue', column: 'revenue_total', label: 'Revenue' },
  }

  const contexts = () => sent.filter((message) => message.type === 'studio:sandbox:context')

  it('rides on every context message once set, and the same scope again posts nothing', async () => {
    render(<Panel id="by_month" title="Monthly revenue" queryId="revenue_by_month" />)
    await flush()
    setPageScope(SCOPE)
    await flush()
    expect(contexts().at(-1)?.scope).toEqual(SCOPE)

    const before = contexts().length
    setPageScope(JSON.parse(JSON.stringify(SCOPE)) as PageScope)
    await flush()
    expect(contexts()).toHaveLength(before)
  })

  it('is trimmed to what the host accepts, and a window that is not real days is left out', async () => {
    render(<Panel id="by_month" title="Monthly revenue" />)
    await flush()
    const values = Array.from({ length: 150 }, (_, index) => `v${index}`)
    setPageScope({
      ...SCOPE,
      window: { from: '2026-02-31', to: '2026-03-01', isDefault: false },
      filters: Array.from({ length: 30 }, (_, index) => ({ field: `f${index}`, label: 'x'.repeat(300), values, isDefault: false })),
    })
    await flush()
    const scope = contexts().at(-1)?.scope
    expect(scope?.window).toBeUndefined()
    expect(scope?.filters).toHaveLength(24)
    expect(scope?.filters[0]?.values).toHaveLength(100)
    expect(scope?.filters[0]?.label).toHaveLength(256)
  })
})

describe('describing the page', () => {
  const TIME: OutlineControl = {
    id: 'time',
    kind: 'dateRange',
    label: 'Time',
    options: [
      { value: '7d', label: 'Last 7 days' },
      { value: '30d', label: 'Last 30 days' },
    ],
    default: ['30d'],
    range: { min: '2025-01-01', max: '2026-06-30' },
  }
  const TOP_N: OutlineControl = {
    id: 'top_n',
    kind: 'select',
    label: 'Show',
    options: [
      { value: '10', label: 'Top 10' },
      { value: '25', label: 'Top 25' },
    ],
    default: ['10'],
    panelId: 'by_region',
  }

  // Each control reported by the component that draws it, as README-FOR-AGENTS.md says: effects run children first.
  function TimeRow() {
    useReportControl(TIME)
    return null
  }
  function ChannelFilter({ channels }: { channels: readonly string[] | undefined }) {
    // Built inline on every render, with its options once they load.
    useReportControl({ id: 'channel', kind: 'filter', label: 'Channel', ...(channels === undefined ? {} : { options: channels.map((value) => ({ value })) }), default: ['All'] })
    return null
  }
  function TopN() {
    useReportControl(TOP_N)
    return null
  }
  function Page({ channels, topN = true }: { channels?: readonly string[]; topN?: boolean }) {
    return (
      <>
        <TimeRow />
        <ChannelFilter channels={channels} />
        <Panel id="by_region" title="Revenue by region">
          {topN ? <TopN /> : null}
        </Panel>
      </>
    )
  }

  const contexts = () => sent.filter((message) => message.type === 'studio:sandbox:context')
  const outline = () => contexts().at(-1)?.outline

  // The page info outlives a test in this module's registry: start each one without it.
  beforeEach(() => setPageInfo({}))

  // Unmount while the clock is still fake, and let the frame that schedules run: one left
  // pending when the real clock is back would never fire, and the registry would wait on it.
  afterEach(async () => {
    cleanup()
    await flush()
  })

  it('reports the controls in the order they register, keeps a control in its place when it updates, and drops one that unmounts', async () => {
    const view = render(<Page />)
    await flush()
    expect(outline()?.controls).toEqual([TIME, { id: 'channel', kind: 'filter', label: 'Channel', default: ['All'] }, TOP_N])

    view.rerender(<Page channels={['All', 'online', 'store']} />)
    await flush()
    expect(outline()?.controls.map((control) => control.id)).toEqual(['time', 'channel', 'top_n'])
    expect(outline()?.controls[1]?.options).toEqual([{ value: 'All' }, { value: 'online' }, { value: 'store' }])

    view.rerender(<Page channels={['All', 'online', 'store']} topN={false} />)
    await flush()
    expect(outline()?.controls.map((control) => control.id)).toEqual(['time', 'channel'])

    view.unmount()
    await flush()
    expect(outline()?.controls).toEqual([])
  })

  it('carries the page info with the controls, whole every time', async () => {
    render(<Page />)
    const info = {
      title: 'Retail orders',
      description: 'Which channels and regions move orders.',
      notes: ['Orders are complete up to yesterday; refunds lag by about three days.'],
      tabs: [
        { label: 'Overview', active: true },
        { label: 'Details', active: false },
      ],
      panels: [{ panelId: 'by_region', title: 'Revenue by region', kind: 'bar', explain: 'Revenue summed per region over the window.' }],
    }
    setPageInfo(info)
    await flush()
    expect(outline()).toEqual({ ...info, controls: [TIME, { id: 'channel', kind: 'filter', label: 'Channel', default: ['All'] }, TOP_N] })

    // A field left out is no longer reported.
    setPageInfo({ title: 'Retail orders' })
    await flush()
    expect(outline()).toEqual({ title: 'Retail orders', controls: expect.any(Array) })
  })

  it('posts nothing for the same outline again, and a change on the next frame', async () => {
    render(<Page />)
    setPageInfo({ title: 'Retail orders' })
    await flush()
    const before = contexts().length

    registerControl({ ...TIME })
    setPageInfo({ title: 'Retail orders' })
    await flush()
    expect(contexts()).toHaveLength(before)

    // Well inside the registry's 100 ms debounce: only the next-frame report can have gone out.
    setPageInfo({ title: 'Retail orders, by week' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30)
    })
    expect(contexts().length).toBeGreaterThan(before)
    expect(outline()?.title).toBe('Retail orders, by week')
  })

  it('is trimmed to what the host accepts, never thrown', async () => {
    render(<Panel id="by_month" title="Monthly revenue" />)
    const long = 'x'.repeat(1500)
    const options = Array.from({ length: 150 }, (_, index) => ({ value: `v${index}_${'y'.repeat(300)}`, label: long }))
    const ids = Array.from({ length: 30 }, (_, index) => `c${index}`)
    registerControl({ id: 'wide', kind: 'k'.repeat(100), label: long, options, multi: true, maxPicks: 5000, default: options.map((option) => option.value), panelId: long })
    // Not a real day, and a range the wrong way round: both left out. `maxPicks` without `multi` too.
    registerControl({ id: 'odd', kind: 'dateRange', label: 'Time', optionCount: 2_000_000.5, maxPicks: 3, range: { min: '2026-02-31', max: '2026-03-01' } })
    registerControl({ id: 'backwards', kind: 'dateRange', label: 'Time', range: { min: '2026-03-01', max: '2026-01-01' } })
    for (const id of ids) registerControl({ id, kind: 'toggle', label: id })
    setPageInfo({
      title: long,
      description: long,
      notes: Array.from({ length: 10 }, () => long),
      tabs: Array.from({ length: 20 }, () => ({ label: long, active: false })),
      panels: Array.from({ length: 60 }, () => ({ panelId: long, title: long, kind: long, explain: long, tab: long })),
    })
    await flush()

    const trimmed = outline()
    expect(trimmed?.controls).toHaveLength(24)
    const [wide, odd, backwards] = trimmed?.controls ?? []
    expect(wide?.kind).toHaveLength(64)
    expect(wide?.label).toHaveLength(256)
    expect(wide?.options).toHaveLength(100)
    expect(wide?.options?.[0]?.value).toHaveLength(256)
    expect(wide?.options?.[0]?.label).toHaveLength(256)
    expect(wide?.optionCount).toBe(150)
    expect(wide?.maxPicks).toBe(1000)
    expect(wide?.default).toHaveLength(100)
    expect(wide?.panelId).toHaveLength(128)
    expect(odd).toEqual({ id: 'odd', kind: 'dateRange', label: 'Time', optionCount: 1_000_000 })
    expect(backwards).toEqual({ id: 'backwards', kind: 'dateRange', label: 'Time' })

    expect(trimmed?.title).toHaveLength(256)
    expect(trimmed?.description).toHaveLength(1000)
    expect(trimmed?.notes).toHaveLength(8)
    expect(trimmed?.notes?.[0]).toHaveLength(1000)
    expect(trimmed?.tabs).toHaveLength(12)
    expect(trimmed?.tabs?.[0]?.label).toHaveLength(256)
    expect(trimmed?.panels).toHaveLength(48)
    expect(trimmed?.panels?.[0]).toEqual({ panelId: 'x'.repeat(128), title: 'x'.repeat(256), kind: 'x'.repeat(64), explain: 'x'.repeat(1000), tab: 'x'.repeat(256) })

    for (const id of ['wide', 'odd', 'backwards', ...ids]) unregisterControl(id)
  })
})
