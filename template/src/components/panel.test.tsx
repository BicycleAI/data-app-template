/**
 * What a `<Panel>` tells the host's chat, and what a `<Chart>` inside one adds.
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
import { Chart, pointSelection } from './Chart.js'
import { Panel, digestOf } from './Panel.js'

type Report = { panelId: string; recipe: string; say?: string; queryId?: string; digest?: unknown; selection?: unknown }

const sent: Array<{ type: string; panels: Report[] }> = []
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
