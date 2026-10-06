import { afterEach, describe, expect, it, vi } from 'vitest'
import { bda } from './bda.js'
import { DE_EMPTY, type DataEvent, reduceDE } from './fn.js'

afterEach(() => vi.restoreAllMocks())

type Sent = { type: string; requestId: string; [k: string]: unknown }

/** Pretend to be framed: `host` answers each posted message with zero or more replies, like fnBridge.ts. */
function framed(host: (message: Sent) => Array<Record<string, unknown>>) {
  const sent: Sent[] = []
  const parent = {
    postMessage: (message: Sent) => {
      sent.push(message)
      for (const reply of host(message)) {
        queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: message.requestId, ...reply } })))
      }
    },
  }
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
  return sent
}

const INV = 'inv_01J8Z3K6T9W2Q4R7M5N8P0XYZA'
const running = { invocation_id: INV, status: 'running' }
const events = (extra: Record<string, unknown>) => ({ type: 'studio:sandbox:fn-events', invocationId: INV, ok: true, events: [], agentEvents: [], items: [], nextAfter: 0, ...extra })

describe('bda.fn', () => {
  it('call submits the local name, streams progress, and resolves with the output', async () => {
    const sent = framed((m) =>
      m.type === 'studio:sandbox:fn-call'
        ? [{ type: 'studio:sandbox:fn-result', ok: true, invocation: running }]
        : [
            events({ events: [{ seq: 1 }], items: [{ key: 'i1', kind: 'status', title: 'Started' }], final: false }),
            events({ final: true, invocation: { ...running, status: 'succeeded', output: { summary: 'ok' } } }),
          ],
    )
    const seen: string[] = []
    await expect(bda.fn.call('check_tickets', { vendor: 'Galaxy Connect' }, { onEvent: (e) => seen.push(...e.items.map((i) => i.title)) })).resolves.toEqual({ summary: 'ok' })
    expect(sent[0]).toMatchObject({ type: 'studio:sandbox:fn-call', name: 'check_tickets', input: { vendor: 'Galaxy Connect' }, mode: 'submit' })
    expect(sent[1]).toMatchObject({ type: 'studio:sandbox:fn-watch', invocationId: INV, after: 0 })
    expect(seen).toEqual(['Started'])
  })

  it('call rejects in words: refused by the host, a failed run, a cancelled run', async () => {
    framed(() => [{ type: 'studio:sandbox:fn-result', ok: false, error: { code: 'fn_not_declared', message: 'This app does not declare it.', status: 0 } }])
    await expect(bda.fn.call('nope', {})).rejects.toMatchObject({ code: 'fn_not_declared', message: 'This app does not declare it.' })

    vi.restoreAllMocks()
    framed((m) =>
      m.type === 'studio:sandbox:fn-call'
        ? [{ type: 'studio:sandbox:fn-result', ok: true, invocation: running }]
        : [events({ final: true, invocation: { ...running, status: 'failed', error: { code: 'budget_exceeded', message: 'The agent ran out of budget.' } } })],
    )
    await expect(bda.fn.call('check_tickets', {})).rejects.toMatchObject({ code: 'budget_exceeded', message: 'The agent ran out of budget.' })

    expect(() => bda.fn.outputOf({ invocation_id: INV, status: 'cancelled' })).toThrow('The run was cancelled.')
  })

  it('wait: false resolves with the invocation; cancel names it', async () => {
    const sent = framed((m) => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: m.type === 'studio:sandbox:fn-cancel' ? { ...running, status: 'cancelled' } : running }])
    await expect(bda.fn.call('check_tickets', {}, { wait: false })).resolves.toEqual(running)
    await expect(bda.fn.cancel(INV)).resolves.toMatchObject({ status: 'cancelled' })
    expect(sent.map((m) => m.type)).toEqual(['studio:sandbox:fn-call', 'studio:sandbox:fn-cancel'])
  })

  it('watch rejects when the host ends it with an error', async () => {
    framed(() => [events({ ok: false, final: true, error: { code: 'invocation_not_found', message: 'This app did not start that run.' } })])
    await expect(bda.fn.watch(INV).done).rejects.toMatchObject({ code: 'invocation_not_found' })
  })

  it('is unavailable outside the host', async () => {
    await expect(bda.fn.call('check_tickets', {})).rejects.toMatchObject({ code: 'fn_unavailable' })
  })

  it('passes reuse and refresh through to the host, and keeps what the answer says', async () => {
    const reused = { invocation_id: INV, status: 'succeeded', reused: true, created_at: '2026-09-26T08:05:00Z', output: { summary: 'ok' } }
    const sent = framed(() => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: reused }])
    const inv = await bda.fn.run('check_tickets', { vendor: 'Galaxy Connect' }, { reuse: '6h' })
    expect(sent[0]).toMatchObject({ type: 'studio:sandbox:fn-call', name: 'check_tickets', mode: 'submit', reuse: '6h' })
    expect(sent[0]).not.toHaveProperty('refresh')
    expect(sent).toHaveLength(1) // a reused answer is terminal: nothing to watch
    expect(inv).toMatchObject({ reused: true, created_at: '2026-09-26T08:05:00Z' })
    await bda.fn.run('check_tickets', {}, { refresh: true })
    expect(sent[1]).toMatchObject({ refresh: true })
    expect(sent[1]).not.toHaveProperty('reuse')
    await bda.fn.call('check_tickets', {})
    expect(sent[2]).not.toHaveProperty('reuse')
  })

  it('watch hands over the data events of each batch, parsed, beside the raw events', async () => {
    const finding = { v: 'de/1', run: INV, t: 1200, k: 'a1', segment: { platform: 'web' }, pct: 41.5 }
    framed((m) =>
      m.type === 'studio:sandbox:fn-watch'
        ? [
            events({
              events: [
                { seq: 1, type: 'started', at: '2026-10-06T10:00:00Z' },
                { seq: 2, type: 'data', at: '2026-10-06T10:00:01Z', name: 'de.finding.detected', data: finding },
                { seq: 3, type: 'log', lines: [{ msg: 'x' }] },
                { seq: 'x', type: 'data', name: 'bad-seq', data: 1 },
                { seq: 4, type: 'data', data: 'no name' },
              ],
              final: false,
            }),
            events({ events: [{ seq: 5, type: 'data', name: 'tick', data: [1, 2] }], final: true, invocation: { ...running, status: 'succeeded', output: {} } }),
          ]
        : [],
    )
    const batches: DataEvent[][] = []
    await bda.fn.watch(INV, (b) => batches.push([...b.data])).done
    expect(batches).toEqual([[{ seq: 2, at: '2026-10-06T10:00:01Z', name: 'de.finding.detected', data: finding }], [{ seq: 5, name: 'tick', data: [1, 2] }]])
    expect(bda.fn.dataEvents([{ seq: 9, type: 'progress', pct: 5 }])).toEqual([])
  })

  describe('reduceDE', () => {
    const env = { v: 'de/1', run: INV }
    let n = 0
    const de = (name: string, data: Record<string, unknown>): DataEvent => ({ seq: (n += 1), name: `de.${name}`, data: { ...env, t: n * 10, ...data } })

    it('folds detected, superseded, kept and explanation.ready by key, with stage progress', () => {
      n = 0
      const stream = [
        de('run.started', { metric: 'units' }),
        de('stage.started', { stage: 'detect' }),
        de('stage.progress', { stage: 'detect', completed: 1, total: 2 }),
        de('finding.detected', { k: 'a', segment: { platform: 'web' }, current: 120, baseline: 80, pct: 50, direction: 'up' }),
        de('finding.detected', { k: 'b', segment: { platform: 'web', zone: 'north' }, current: 60, baseline: 30, pct: 100 }),
        de('stage.finished', { stage: 'detect' }),
        de('stage.started', { stage: 'supersede' }),
        de('finding.superseded', { k: 'b', by: 'a', reason: 'explained by its parent' }),
        de('finding.kept', { k: 'a', representative: true }),
        de('stage.finished', { stage: 'supersede' }),
        de('stage.progress', { stage: 'explain', completed: 1, total: 4 }),
        de('explanation.ready', { finding: 'a', drivers: Array.from({ length: 12 }, (_, i) => ({ segment: { sku: `s${i}` }, contribution: 0.5 })), depth: 2 }),
      ]
      const half = reduceDE(stream.slice(0, 3))
      expect(half).toMatchObject({ status: 'running', stage: 'detect', progress: 20, final: false, findings: [] })
      const s = reduceDE(stream)
      expect(s.status).toBe('running')
      expect(s.progress).toBe(61) // explain 50-95, 1 of 4
      expect(s.findings.map((f) => [f.k, f.status])).toEqual([
        ['a', 'kept'],
        ['b', 'superseded'],
      ])
      const [a, b] = s.findings
      expect(a).toMatchObject({ segment: { platform: 'web' }, current: 120, pct: 50, direction: 'up', representative: true, supersedes: ['b'], depth: 2 })
      expect(a?.drivers).toHaveLength(10)
      expect(b).toMatchObject({ supersededBy: 'a', reason: 'explained by its parent', pct: 100 })
      // incremental folding gives the same answer, and a replayed page changes nothing
      const step = stream.reduce((st, e) => reduceDE([e], st), DE_EMPTY)
      expect(step).toEqual(s)
      expect(reduceDE(stream.slice(4, 8), s)).toEqual(s)
    })

    it('is replaced by the inline output on run.done, and keeps the rows when the output is by reference', () => {
      n = 0
      const live = reduceDE([de('finding.detected', { k: 'a', pct: 10 }), de('stage.progress', { stage: 'detect', completed: 1, total: 1 })])
      const done = reduceDE([de('run.done', { status: 'partial', summary: { kept: 1 }, output: { findings: [{ k: 'a' }] }, cancel: { reason: 'TIMEOUT' } })], live)
      expect(done).toMatchObject({ final: true, status: 'partial', progress: 100, findings: [], output: { findings: [{ k: 'a' }] }, summary: { kept: 1 } })
      const byRef = reduceDE([de('run.done', { status: 'ok', output_ref: { blob_id: 'b1' } })], live)
      expect(byRef).toMatchObject({ final: true, status: 'ok', outputRef: { blob_id: 'b1' } })
      expect(byRef.findings.map((f) => f.k)).toEqual(['a'])
      expect(byRef).not.toHaveProperty('output')
    })

    it('says a failed run in its words, and ignores events that are not de/1', () => {
      n = 2
      const s = reduceDE([
        { seq: 1, name: 'other.thing', data: { k: 'x' } },
        { seq: 2, name: 'de.finding.detected', data: { v: 'de/2', k: 'y' } },
        de('run.failed', { code: 'deadline_exceeded', message: 'The run hit its time limit.' }),
      ])
      expect(s).toMatchObject({ status: 'failed', final: true, findings: [], error: { code: 'deadline_exceeded', message: 'The run hit its time limit.' } })
    })
  })
})
