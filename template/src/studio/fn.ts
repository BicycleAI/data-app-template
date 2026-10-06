/**
 * `bda.fn`: an app's published functions and workflows, run through the Studio host (ui-bicycle-studio
 * `sandbox/fnBridge.ts`, INVOCATIONS.md "v1.2 apps"). Served by Studio (`GET /api/data-apps/sdk`, MCP `dataapp_sdk`)
 * for a template-built app's `src/studio/`; it needs the template's `src/studio/types.ts` (BdaError) and nothing else.
 *
 *   -> { type: 'studio:sandbox:fn-call', requestId, name, input, mode: 'submit' | 'invoke', reuse?, refresh? }
 *   <- { type: 'studio:sandbox:fn-result', requestId, ok, invocation?, error? }
 *   -> { type: 'studio:sandbox:fn-watch', requestId, invocationId, after }
 *   <- { type: 'studio:sandbox:fn-events', requestId, invocationId, ok, events, agentEvents, items, nextAfter,
 *        invocation?, error?, final }   (repeated until final)
 *   -> { type: 'studio:sandbox:fn-cancel', requestId, invocationId }  <- fn-result
 *
 * A code function can send structured events while it runs (`ctx.emit(name, data)`, runtime contract 1.20.0): the
 * stream carries them as `{type: 'data', seq, name, data}`, and `watch` hands them over parsed in `batch.data`.
 * `reduceDE` folds Detect & Explain's (`de/1`) into live findings; the final output stays the result.
 *
 * What an app may call is declared in `bda.manifest.json` `functions: {<local>: {ref}}`, pinned: a function
 * (`fn:{tenant}/{name}@{n}`) or a published workflow (`wf:{tenant}/{slug}@{n}`). App code names the LOCAL name
 * only - the host refuses a ref or an undeclared name - and Studio runs the ref as the viewer. Output is data:
 * render it as text, never as HTML.
 */

import { BdaError } from './types.js'

export type InvocationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Studio's Invocation record (the fields an app reads). */
export type Invocation = {
  readonly invocation_id: string
  readonly kind?: string
  readonly status: InvocationStatus
  readonly created_at?: string
  readonly started_at?: string
  readonly finished_at?: string
  readonly output?: unknown
  readonly error?: { readonly code?: string; readonly message?: string } | null
  readonly usage?: { readonly llm_usd?: number; readonly wall_ms?: number; readonly steps?: number; readonly tool_calls?: number }
  /** true: Studio answered an earlier run of the same call (yours, within `reuse`); `created_at` says when it ran. */
  readonly reused?: boolean
  /** true: the same call was already running; this is that run. */
  readonly attached?: boolean
  /** While `queued` for a free agent slot: how many runs are ahead (0 = next). */
  readonly queue_position?: number
}

/** One progress line in words, as the host read an event ("Step 3", "Atlassian · search jira issues"). */
export type ProgressItem = {
  readonly key: string
  readonly at?: string
  readonly kind: string
  readonly title: string
  readonly detail?: string
  readonly meta?: string
  readonly bad?: boolean
}

/** One structured event a code function sent with `ctx.emit(name, data)` (a `data` event on its stream). */
export type DataEvent = {
  readonly seq: number
  readonly at?: string
  /** The function's name for it, dotted by convention (`de.finding.detected`). */
  readonly name: string
  /** The JSON value the function sent: data, never markup. */
  readonly data: unknown
}

export type FnEvents = {
  readonly invocationId: string
  readonly events: readonly Record<string, unknown>[]
  readonly agentEvents: readonly Record<string, unknown>[]
  readonly items: readonly ProgressItem[]
  /** This batch's `data` events (from `ctx.emit`), in order. */
  readonly data: readonly DataEvent[]
  readonly nextAfter: number
}

/** The `data` events among raw stream events, parsed: those with a numeric `seq` and a string `name`, in order. */
export const dataEvents = (events: readonly Record<string, unknown>[]): DataEvent[] =>
  events.flatMap((e) => {
    if (e.type !== 'data' || typeof e.name !== 'string') return []
    const seq = Number(e.seq)
    if (!Number.isFinite(seq)) return []
    return [{ seq, name: e.name, data: e.data, ...(typeof e.at === 'string' ? { at: e.at } : {}) }]
  })

export type Watch = {
  /** The final invocation (terminal), or rejects with a BdaError when watching failed. */
  readonly done: Promise<Invocation>
  /** Stop listening (the run carries on). */
  readonly stop: () => void
}

const CALL = 'studio:sandbox:fn-call'

export type CallOptions = {
  /** true (default): resolve with the output once the run ends. false: resolve with the queued invocation. */
  readonly wait?: boolean
  /** Progress while waiting. */
  readonly onEvent?: (events: FnEvents) => void
  /** Told the invocation id as soon as it exists (for a Cancel button, or a link to its trace). */
  readonly onStart?: (invocation: Invocation) => void
  /**
   * Answer from your own earlier run of the same call if it succeeded within this window ("6h"; at most "24h").
   * ALWAYS pass it for a call made on page load, and show "as of <created_at>" with a Refresh.
   */
  readonly reuse?: string
  /** true: always a new run (the Refresh button). */
  readonly refresh?: boolean
}

const callMessage = (name: string, input: Record<string, unknown>, options: CallOptions) => ({
  type: CALL,
  name,
  input,
  mode: 'submit',
  ...(options.reuse !== undefined ? { reuse: options.reuse } : {}),
  ...(options.refresh === true ? { refresh: true } : {}),
})

const RESULT = 'studio:sandbox:fn-result'
const WATCH = 'studio:sandbox:fn-watch'
const EVENTS = 'studio:sandbox:fn-events'
const CANCEL = 'studio:sandbox:fn-cancel'
const HOST_TIMEOUT_MS = 60_000
const TERMINAL = new Set<string>(['succeeded', 'failed', 'cancelled'])
let nextRequestId = 0

type Reply = {
  type?: string
  requestId?: string
  ok?: boolean
  invocation?: Invocation
  error?: { code?: string; message?: string; status?: number }
  final?: boolean
} & Partial<FnEvents>

const framed = () => typeof window !== 'undefined' && window.parent !== window

const toError = (error: Reply['error'] | undefined, fallback: string) =>
  new BdaError(error?.code ?? 'request_failed', error?.message ?? fallback, error?.status ?? 0)

/** One request, one fn-result reply. */
const ask = (message: Record<string, unknown>): Promise<Invocation> => {
  if (!framed()) return Promise.reject(new BdaError('fn_unavailable', 'Functions need the Studio host.', 0))
  const requestId = `f${(nextRequestId += 1)}`
  return new Promise<Invocation>((resolve, reject) => {
    const settle = (run: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      run()
    }
    const onMessage = (event: MessageEvent<Reply>) => {
      const reply = event.data
      if (reply?.type !== RESULT || reply.requestId !== requestId) return
      const invocation = reply.invocation
      if (reply.ok === true && invocation !== undefined) settle(() => resolve(invocation))
      else settle(() => reject(toError(reply.error, 'The call failed.')))
    }
    const timer = window.setTimeout(() => settle(() => reject(new BdaError('host_timeout', 'The host did not answer.', 0))), HOST_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ ...message, requestId }, '*')
  })
}

/** Follow a run this app started, event by event, until it ends. */
export const watch = (invocationId: string, onEvent?: (events: FnEvents) => void, after = 0): Watch => {
  if (!framed()) {
    return { done: Promise.reject(new BdaError('fn_unavailable', 'Functions need the Studio host.', 0)), stop: () => undefined }
  }
  const requestId = `w${(nextRequestId += 1)}`
  let stop = () => undefined as void
  const done = new Promise<Invocation>((resolve, reject) => {
    const onMessage = (event: MessageEvent<Reply>) => {
      const reply = event.data
      if (reply?.type !== EVENTS || reply.requestId !== requestId) return
      if (reply.ok === false) {
        stop()
        reject(toError(reply.error, 'Following the run failed.'))
        return
      }
      if ((reply.events?.length ?? 0) + (reply.agentEvents?.length ?? 0) > 0) {
        const events = reply.events ?? []
        onEvent?.({
          invocationId,
          events,
          agentEvents: reply.agentEvents ?? [],
          items: reply.items ?? [],
          data: dataEvents(events),
          nextAfter: reply.nextAfter ?? 0,
        })
      }
      if (reply.final === true) {
        stop()
        if (reply.invocation) resolve(reply.invocation)
        else reject(new BdaError('invocation_unreadable', 'The run ended but its result could not be read.', 0))
      }
    }
    stop = () => window.removeEventListener('message', onMessage)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: WATCH, requestId, invocationId, after }, '*')
  })
  return { done, stop: () => stop() }
}

/** The final invocation's output, or a readable BdaError for a failed or cancelled run. */
export const outputOf = (invocation: Invocation): unknown => {
  if (invocation.status === 'succeeded') return invocation.output
  if (invocation.status === 'cancelled') throw new BdaError('cancelled', 'The run was cancelled.', 0)
  throw new BdaError(invocation.error?.code ?? 'function_failed', invocation.error?.message ?? 'The run failed.', 0)
}

/** Start a run and wait for its final invocation (output, usage, timings), with progress on the way. */
export const run = async (name: string, input: Record<string, unknown>, options: Omit<CallOptions, 'wait'> = {}): Promise<Invocation> => {
  const started = await ask(callMessage(name, input, options))
  options.onStart?.(started)
  if (TERMINAL.has(started.status)) return started
  return watch(started.invocation_id, options.onEvent).done
}

/**
 * `bda.fn.call(name, input)`: the output once the run ends (throws a BdaError in words when it failed).
 * `{wait: false}`: the queued invocation at once; follow it with `bda.fn.watch`.
 */
export function call(name: string, input: Record<string, unknown>, options: CallOptions & { wait: false }): Promise<Invocation>
export function call<T = unknown>(name: string, input: Record<string, unknown>, options?: CallOptions): Promise<T>
export async function call(name: string, input: Record<string, unknown>, options: CallOptions = {}): Promise<unknown> {
  if (options.wait === false) {
    const started = await ask(callMessage(name, input, options))
    options.onStart?.(started)
    return started
  }
  return outputOf(await run(name, input, options))
}

/** Cancel a run this app started. */
export const cancel = (invocationId: string): Promise<Invocation> => ask({ type: CANCEL, invocationId })

// ---- Detect & Explain live findings (de/1) ----------------------------------------------------------------------

/** A driver of a finding's change, as `de.explanation.ready` lists them (at most 10). */
export type DEDriver = {
  readonly segment?: Readonly<Record<string, unknown>>
  readonly contribution?: number
  readonly delta?: number
}

/** One finding as the stream has told it so far, keyed by `k`. */
export type DEFinding = {
  readonly k: string
  /** detected: found, not yet judged; superseded: folded under `supersededBy`; kept: a finding the run keeps. */
  readonly status: 'detected' | 'superseded' | 'kept'
  readonly segment?: Readonly<Record<string, unknown>>
  readonly current?: number
  readonly baseline?: number
  readonly lower?: number
  readonly upper?: number
  readonly delta?: number
  readonly pct?: number
  readonly direction?: string
  readonly supersededBy?: string
  readonly reason?: string
  /** The keys this finding supersedes (render them greyed out beneath it). */
  readonly supersedes: readonly string[]
  readonly representative?: boolean
  readonly lateralCluster?: unknown
  readonly drivers?: readonly DEDriver[]
  readonly depth?: number
}

export type DEState = {
  /** The last `seq` folded in: a replayed page (resume with `after`) is skipped. */
  readonly seq: number
  readonly status: 'idle' | 'running' | 'ok' | 'partial' | 'cancelled' | 'failed'
  readonly stage?: string
  /** 0-100: detect 0-40, supersede 40-50, explain 50-95, 100 at the end. Never goes back. */
  readonly progress: number
  /** Findings in the order first seen. Empty once `final` with an inline output: render `output` then. */
  readonly findings: readonly DEFinding[]
  readonly summary?: unknown
  /** `run.done`'s output when it came inline (the invocation's output is the same, and authoritative). */
  readonly output?: unknown
  readonly outputRef?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
  /** true after `run.done` or `run.failed`: the live rows are over; render the output. */
  readonly final: boolean
}

export const DE_EMPTY: DEState = { seq: 0, status: 'idle', progress: 0, findings: [], final: false }

const STAGE_SPAN: Record<string, readonly [number, number]> = {
  detect: [0, 40],
  supersede: [40, 50],
  explain: [50, 95],
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
/** `o` without its undefined fields: what an optional field means under exactOptionalPropertyTypes. */
const defined = <T,>(o: Record<string, unknown>): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
type Loose<T> = { [K in keyof T]?: T[K] | undefined }

/**
 * Fold Detect & Explain's `de/1` events (`de.<event>` data events from `watch`) into live findings: a pure fold, so
 * `state = reduceDE(batch.data, state)` per batch, or `reduceDE(allEvents)` at once. Other events are ignored, and so is
 * any `seq` already folded in (a resumed watch can replay a page).
 *
 * `finding.detected` adds a row; `finding.superseded` folds it under `by`; `finding.kept` marks it kept;
 * `explanation.ready` attaches its drivers; `stage.*` move `progress`. `run.done` ends it: with an inline output the
 * rows are replaced by `output`, otherwise they stay until the invocation's output is read. The final output is the
 * truth; these events are for watching.
 */
export const reduceDE = (events: readonly DataEvent[], prior: DEState = DE_EMPTY): DEState => {
  let seq = prior.seq
  let status = prior.status
  let stage = prior.stage
  let progress = prior.progress
  let final = prior.final
  let summary = prior.summary
  let output = prior.output
  let outputRef = prior.outputRef
  let error = prior.error
  const byKey = new Map<string, DEFinding>(prior.findings.map((f) => [f.k, f]))
  const upsert = (k: string, change: Loose<DEFinding>) => {
    const was: DEFinding = byKey.get(k) ?? { k, status: 'detected', supersedes: [] }
    byKey.set(k, { ...was, ...defined<Partial<DEFinding>>(change) })
  }
  const advance = (to: number) => {
    progress = Math.max(progress, Math.min(100, Math.round(to)))
  }
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.seq <= seq || !e.name.startsWith('de.')) continue
    seq = e.seq
    const d = rec(e.data)
    if (d.v !== undefined && d.v !== 'de/1') continue
    if (status === 'idle') status = 'running'
    const k = str(d.k)
    switch (e.name.slice(3)) {
      case 'stage.started':
      case 'stage.progress':
      case 'stage.finished': {
        stage = str(d.stage) ?? stage
        const span = STAGE_SPAN[stage ?? '']
        if (!span) break
        const [lo, hi] = span
        if (e.name === 'de.stage.finished') advance(hi)
        else {
          const done = num(d.completed)
          const total = num(d.total)
          advance(done !== undefined && total ? lo + ((hi - lo) * Math.min(done, total)) / total : lo)
        }
        break
      }
      case 'finding.detected':
        if (k)
          upsert(k, {
            segment: rec(d.segment),
            current: num(d.current),
            baseline: num(d.baseline),
            lower: num(d.lower),
            upper: num(d.upper),
            delta: num(d.delta),
            pct: num(d.pct),
            direction: str(d.direction),
          })
        break
      case 'finding.superseded': {
        const by = str(d.by)
        if (!k) break
        upsert(k, { status: 'superseded', supersededBy: by, reason: str(d.reason) })
        if (by) {
          const parent = byKey.get(by) ?? { k: by, status: 'detected' as const, supersedes: [] }
          if (!parent.supersedes.includes(k)) byKey.set(by, { ...parent, supersedes: [...parent.supersedes, k] })
        }
        break
      }
      case 'finding.kept':
        if (k) upsert(k, { status: 'kept', representative: typeof d.representative === 'boolean' ? d.representative : undefined, lateralCluster: d.lateral_cluster })
        break
      case 'explanation.ready': {
        const of = str(d.finding)
        const drivers = Array.isArray(d.drivers) ? d.drivers.slice(0, 10).map((x) => rec(x) as DEDriver) : []
        if (of) upsert(of, { drivers, depth: num(d.depth) })
        break
      }
      case 'run.done': {
        final = true
        const said = str(d.status)
        status = said === 'partial' || said === 'cancelled' ? said : 'ok'
        progress = 100
        summary = d.summary
        if (d.output !== undefined) output = d.output
        if (d.output_ref !== undefined) outputRef = d.output_ref
        break
      }
      case 'run.failed':
        final = true
        status = 'failed'
        error = defined<NonNullable<DEState['error']>>({ code: str(d.code), message: str(d.message) })
        break
      default:
        break
    }
  }
  const findings = final && output !== undefined ? [] : [...byKey.values()]
  return defined<DEState>({ seq, status, stage, progress, findings, summary, output, outputRef, error, final })
}

export const fn = { call, run, watch, cancel, outputOf, dataEvents, reduceDE } as const
