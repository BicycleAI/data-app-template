/**
 * The Detect & Explain example against a stand-in host: the last result on load, then a Refresh whose `de.*` events
 * show as live findings until the output replaces them.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetectExplainLive, outputRows } from './DetectExplainLive.js'

type Sent = { type: string; requestId: string; [k: string]: unknown }

const INV = 'inv_01J8Z3K6T9W2Q4R7M5N8P0XYZA'
const OUTPUT = { stages: { supersede: [{ platform: 'web', zone: 'north', pct_change: 50 }] } }
const env = { v: 'de/1', run: INV }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A framed page: `host` answers each posted message, like the host's fnBridge; `push` sends one more reply later. */
function framed(host: (message: Sent) => Array<Record<string, unknown>>) {
  const sent: Sent[] = []
  const reply = (requestId: string, data: Record<string, unknown>) =>
    window.dispatchEvent(new MessageEvent('message', { data: { requestId, ...data } }))
  const parent = {
    postMessage: (message: Sent) => {
      sent.push(message)
      for (const r of host(message)) queueMicrotask(() => reply(message.requestId, r))
    },
  }
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
  return { sent, push: (requestId: string, data: Record<string, unknown>) => act(async () => reply(requestId, data)) }
}

const events = (extra: Record<string, unknown>) => ({ type: 'studio:sandbox:fn-events', invocationId: INV, ok: true, events: [], agentEvents: [], items: [], nextAfter: 0, ...extra })
const data = (seq: number, name: string, payload: Record<string, unknown>) => ({ seq, type: 'data', name: `de.${name}`, data: { ...env, t: seq, ...payload } })

describe('DetectExplainLive', () => {
  it('shows the last result at once when a recent run answers', async () => {
    const reused = { invocation_id: INV, status: 'succeeded', reused: true, created_at: '2026-10-06T08:00:00Z', output: OUTPUT }
    const { sent } = framed(() => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: reused }])
    await act(async () => {
      render(<DetectExplainLive input={{ metric: 'units' }} />)
    })
    expect(sent[0]).toMatchObject({ type: 'studio:sandbox:fn-call', name: 'detect_and_explain', reuse: '24h', input: { metric: 'units' } })
    expect(screen.getByText(/^As of/)).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'web' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('on Refresh, folds de events into live findings, then replaces them with the output', async () => {
    const running = { invocation_id: INV, status: 'running', created_at: '2026-10-06T09:00:00Z' }
    let watchId = ''
    const { sent, push } = framed((m) => {
      if (m.type === 'studio:sandbox:fn-watch') {
        watchId = m.requestId
        return []
      }
      return [{ type: 'studio:sandbox:fn-result', ok: true, invocation: m.refresh ? running : { ...running, status: 'succeeded', output: OUTPUT } }]
    })
    await act(async () => {
      render(<DetectExplainLive input={{ metric: 'units' }} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    expect(sent[1]).toMatchObject({ type: 'studio:sandbox:fn-call', refresh: true })
    expect(screen.getByRole('button', { name: 'Running…' })).toHaveProperty('disabled', true)

    await push(
      watchId,
      events({
        events: [
          data(1, 'stage.started', { stage: 'detect' }),
          data(2, 'finding.detected', { k: 'a', segment: { platform: 'app' }, pct: 30, current: 13, baseline: 10 }),
          data(3, 'finding.detected', { k: 'b', segment: { platform: 'app', zone: 'east' }, pct: 60 }),
          data(4, 'stage.finished', { stage: 'detect' }),
          data(5, 'finding.superseded', { k: 'b', by: 'a', reason: 'parent' }),
          data(6, 'finding.kept', { k: 'a' }),
          data(7, 'explanation.ready', { finding: 'a', drivers: [{ segment: { sku: 'milk' }, contribution: 0.8 }] }),
        ],
        final: false,
      }),
    )
    const liveRegion = screen.getByRole('region', { name: 'Live findings' })
    expect(liveRegion.textContent).toContain('platform=app +30% (13 vs 10) kept')
    expect(liveRegion.textContent).toContain('Drivers: sku=milk')
    expect(liveRegion.querySelector('[data-k="b"]')?.className).toContain('de-superseded') // folded under a
    expect(liveRegion.querySelector('[data-k="a"] [data-k="b"]')).toBeTruthy()
    expect(screen.getByRole('progressbar').textContent).toBe('detect · 40%')
    expect(screen.getByRole('region', { name: 'Last result' }).getAttribute('style')).toContain('opacity')

    const fresh = { rows: [{ platform: 'app', zone: 'all', pct_change: 30 }] }
    await push(watchId, events({ final: true, invocation: { ...running, status: 'succeeded', output: { stages: { supersede: fresh.rows } } } }))
    expect(screen.queryByRole('region', { name: 'Live findings' })).toBeNull()
    expect(screen.getByRole('cell', { name: 'app' })).toBeTruthy()
    expect(screen.queryByRole('cell', { name: 'web' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', false)
  })

  it('says a failed run in words', async () => {
    framed(() => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: { invocation_id: INV, status: 'failed', error: { code: 'deadline_exceeded', message: 'The run hit its time limit.' } } }])
    await act(async () => {
      render(<DetectExplainLive input={{}} />)
    })
    expect(screen.getByRole('alert').textContent).toBe('The run hit its time limit.')
    expect(screen.queryByRole('region', { name: 'Last result' })).toBeNull()
    expect(outputRows(undefined)).toEqual([])
    expect(outputRows({ stages: { detect: [{ a: 1 }, 'x'] } })).toEqual([{ a: 1 }])
  })
})
