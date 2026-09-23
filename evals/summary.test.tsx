/**
 * T5.4, the `summary` recipe.
 *
 * The frame never fetches (AGENTS.md): every request goes out as a
 * `studio:sandbox:summary` message and this pins the reply shape the recipe
 * expects back (`studio:sandbox:summary-result`, `runtime/src/studio/summary.ts`).
 * A fake host frame (`mockHostFrame`, same pattern as `evals/context.test.tsx`)
 * captures the outgoing request and answers it by hand.
 *
 * What this pins:
 *  - heading + a skeleton on screen before the summary lands ("Widgets never
 *    blank");
 *  - the plain layer renders with its `[n]` reference buttons once the host
 *    answers;
 *  - clicking a reference pulses the panel it came from, reusing the same
 *    `studio:sandbox:highlight` mechanism the host itself would use
 *    (`contextRegistry.ts`);
 *  - "Show the details" reveals each panel's finding, figures and method;
 *  - a `chat_unavailable` (503) reply renders a muted note, never the
 *    standard error card.
 *
 * Synthetic spec and fixture only — no real customer or model ids, per
 * `scripts/no-real-ids.sh`.
 */

import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE } from '../runtime/src/App.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import { Widget } from '../runtime/src/parts.js'
import type { Spec } from '../runtime/src/spec.js'
import { PanelMetaProvider, resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'
import type { SummaryResult } from '../runtime/src/studio/summary.js'

const SPEC: Spec = {
  version: 2,
  model: 'm_retail_demo',
  title: 'Demo report',
  persona: 'biz',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-08-01', to: '2026-09-13', grain: 'day' },
  measures: [{ id: 'orders', column: 'orders_total', label: 'Orders' }],
  dimensions: [{ field: 'region', label: 'Region' }],
  questions: [],
  controls: [],
}

function pending<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

/** `summary`'s own `Render` never reads `core` — this is only here to satisfy `CoreProps`. */
const EMPTY_CORE: CoreData = {
  totals: pending(),
  series: pending(),
  dims: pending(),
  trendBy: () => pending(),
  slicesAt: () => [],
}

const FIXTURE: SummaryResult = {
  plain: 'Orders reached 2,863 this period [1], while the refund rate held near target at 15.8% [2].',
  details: [
    {
      panelId: 'p1:kpis',
      say: 'How many orders come in, and which way is it moving?',
      finding: 'Orders rose 4% week over week, in line with the last month.',
      figures: [{ label: 'Orders', value: '2,863', ref: 1 }],
      method: 'Tiles showing current totals and period-over-period change.',
    },
    {
      panelId: 'p2:trend',
      say: 'How has the refund rate moved since August?',
      finding: 'The refund rate held steady just under its 90% confidence bar.',
      figures: [{ label: 'Refund rate', value: '15.8%', ref: 2 }],
      method: 'Line chart over time for each measure.',
    },
  ],
  refs: [
    { n: 1, query_id: 'totals', sql: "SELECT orders_total FROM m_retail_demo WHERE event_time BETWEEN '2026-08-01' AND '2026-09-13'", params: {}, row: null, value: 2863, as_of: '2026-09-13' },
    { n: 2, query_id: 'by_time', sql: "SELECT refund_rate_pct FROM m_retail_demo WHERE event_time BETWEEN '2026-08-01' AND '2026-09-13'", params: {}, row: null, value: 15.8, as_of: '2026-09-13' },
  ],
  caveats: ['data as of 2026-09-13'],
  follow_ups: ['Which region is carrying the refund rate?'],
  thread_id: 'thread_demo_1',
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

function mountSummary() {
  const Recipe = CORE.summary
  if (Recipe === undefined) throw new Error('no "summary" core recipe')
  const meta = { panelId: 'p0:summary', recipe: 'summary', say: "What's the takeaway?", bind: {} }
  return render(
    <PanelMetaProvider value={meta}>
      <Recipe spec={SPEC} core={EMPTY_CORE} bind={{}} />
    </PanelMetaProvider>,
  )
}

/** A bare target card, standing in for a real recipe's panel — just enough to observe a highlight pulse land on the right one. */
function mountTargetPanel(panelId: string) {
  const meta = { panelId, recipe: 'kpis', say: 'How big is each measure?', bind: {} }
  return render(
    <PanelMetaProvider value={meta}>
      <Widget heading={<div className="kit-sh">Orders</div>} pending={false} skeleton={{ kind: 'metric' }}>
        <span>2,863</span>
      </Widget>
    </PanelMetaProvider>,
  )
}

/** Two animation frames (the recipe's own wait for every sibling panel to register) plus a margin, as real time. */
async function settle(ms = 300): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function summaryRequests(postMessage: ReturnType<typeof vi.fn>) {
  return postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === 'studio:sandbox:summary')
}

function reply(requestId: string, body: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; status: number } }): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:summary-result', requestId, ...body } }))
  })
}

async function mountAndAnswer(postMessage: ReturnType<typeof vi.fn>, body: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; status: number } }) {
  mountSummary()
  await settle()
  const requests = summaryRequests(postMessage)
  expect(requests.length).toBeGreaterThan(0)
  const requestId = requests[requests.length - 1]?.requestId as string
  reply(requestId, body)
  await settle(50)
}

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  restoreHostFrame()
  vi.restoreAllMocks()
})

describe('the summary recipe', () => {
  it('shows the heading and a busy skeleton before the summary lands', () => {
    mockHostFrame()
    mountSummary()
    expect(screen.getByText('Summary')).toBeDefined()
    const card = document.querySelector('.kit-summary')
    expect(card?.getAttribute('aria-busy')).toBe('true')
    expect(card?.textContent).not.toContain('Orders reached')
  })

  it('sends the panels on screen as context, and renders the plain layer with its [n] references once the host answers', async () => {
    const postMessage = mockHostFrame()
    await mountAndAnswer(postMessage, { ok: true, result: FIXTURE })

    const requests = summaryRequests(postMessage)
    expect(Array.isArray(requests[requests.length - 1]?.context)).toBe(true)

    const card = document.querySelector('.kit-summary')
    expect(card?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText(/Orders reached 2,863/)).toBeDefined()
    expect(screen.getByRole('button', { name: '[1]' })).toBeDefined()
    expect(screen.getByRole('button', { name: '[2]' })).toBeDefined()
  })

  it('clicking a reference pulses the panel it came from, and only that one', async () => {
    const postMessage = mockHostFrame()
    mountTargetPanel('p1:kpis')
    mountTargetPanel('p2:trend')
    await mountAndAnswer(postMessage, { ok: true, result: FIXTURE })

    const ref1 = screen.getByRole('button', { name: '[1]' }) as HTMLElement
    act(() => {
      fireEvent.click(ref1)
    })

    const highlighted = document.querySelectorAll('.kit-card--highlight')
    expect(highlighted.length).toBeGreaterThan(0)
    for (const card of highlighted) expect(card.textContent).toContain('Orders')
  })

  it('reveals figures, method, caveats and follow-ups behind "Show the details"', async () => {
    const postMessage = mockHostFrame()
    await mountAndAnswer(postMessage, { ok: true, result: FIXTURE })

    expect(screen.queryByText(/Orders rose 4%/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show the details' }))

    expect(screen.getByText(/Orders rose 4%/)).toBeDefined()
    expect(screen.getByText('2,863')).toBeDefined()
    expect(screen.getByText(/Tiles showing current totals/)).toBeDefined()
    expect(screen.getByText(/data as of 2026-09-13/)).toBeDefined()
    expect(screen.getByText(/Which region is carrying/)).toBeDefined()
  })

  it('renders a muted note, never an error card, on chat_unavailable (503)', async () => {
    const postMessage = mockHostFrame()
    await mountAndAnswer(postMessage, { ok: false, error: { code: 'chat_unavailable', message: 'agent-service is not configured', status: 503 } })

    expect(screen.getByText("Summary isn't available in this environment.")).toBeDefined()
    expect(document.querySelector('.kit-widget-error')).toBeNull()
  })

  it('renders nothing at all on chat_not_declared (404)', async () => {
    const postMessage = mockHostFrame()
    await mountAndAnswer(postMessage, { ok: false, error: { code: 'chat_not_declared', message: 'chat is not enabled for this app', status: 404 } })

    expect(screen.queryByText('Summary')).toBeNull()
    expect(document.querySelector('.kit-summary')).toBeNull()
  })
})
