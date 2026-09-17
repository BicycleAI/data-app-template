/**
 * T5.4, the `summary` recipe's transport.
 *
 * A summary is the two-layer, referenced answer bicycle-studio-api's
 * `POST /api/data-apps/{appId}/summary` produces (MR !19 — see
 * `docs/API.md`'s "## Summary", authoritative): a 3-5 sentence `plain` layer
 * with every figure carrying a `[n]`, and a `details`/`refs` pair that maps
 * each `n` back to the exact query, parameters and row it came from.
 *
 * Message shape (mirrors `store.ts` exactly — read that file first):
 *
 *   -> { type: 'studio:sandbox:summary', requestId, context }
 *   <- { type: 'studio:sandbox:summary-result', requestId, ok, result?, error? }
 *
 * `context` is the panel list `contextRegistry.ts` already builds for the
 * host's own `studio:sandbox:context` message (`currentPanelReports()`) — the
 * same shape, not a new one; the service's `/summary` and `/chat/threads`
 * bodies both accept "panels as the context reporter sees them" with a few
 * optional fields (`filters`, `picked`) this runtime doesn't track yet.
 *
 * `result` is either a finished `SummaryResult` or, when the service is still
 * running the turn, `{ status: 'summarising', thread_id }` (mirroring the
 * API's `202`). This module never polls anything itself:
 *
 * - **Framed**: the host owns the retry. A `summarising` reply just means
 *   "ask me again shortly" — the host may itself be polling
 *   `GET .../chat/threads/{thread_id}` behind the scenes (a separate,
 *   host-side task; not this repo's job — AGENTS.md: "the runtime never
 *   fetches a URL — every capability is a message to the host").
 * - **Dev mode** (no host, direct REST): the same contract applies one level
 *   down. `direct()` only speaks to `/summary`; it does not also poll
 *   `/chat/threads/{id}` itself. A `summarising` result here means the same
 *   thing it means when framed — the caller (the `summary` recipe's own
 *   retry loop, 1.5s -> 4s backoff) asks again, and a repeat `/summary` call
 *   while the turn is in flight is expected to be cheap on the service side
 *   (cache-checked, not recomputed) rather than this module reaching for a
 *   second endpoint.
 *
 * Never thrown for a normal "not there yet" state — `BdaError` is reserved
 * for `chat_not_declared` (404), `chat_unavailable` (503) and the like, which
 * the recipe renders as nothing or a muted note per AGENTS.md's "Widgets
 * never blank" (never an error card here).
 */

import { context } from './context.js'
import type { PanelReport } from './contextRegistry.js'
import { BdaError } from './types.js'

export type SummaryFigure = {
  readonly label: string
  readonly value: string
  readonly ref: number
}

export type SummaryDetail = {
  readonly panelId: string
  readonly say: string
  readonly finding: string
  readonly figures: readonly SummaryFigure[]
  readonly method: string
}

export type SummaryRef = {
  readonly n: number
  readonly query_id: string | null
  readonly sql: string
  readonly params: Readonly<Record<string, unknown>>
  readonly row: Readonly<Record<string, unknown>> | null
  readonly value: unknown
  readonly as_of: string
}

/** The finished, two-layer answer. */
export type SummaryResult = {
  readonly plain: string
  readonly details: readonly SummaryDetail[]
  readonly refs: readonly SummaryRef[]
  readonly caveats?: readonly string[]
  readonly follow_ups?: readonly string[]
  readonly thread_id: string | null
  readonly cached?: boolean
}

/** The service's `202` — the turn is still running. */
export type SummarySummarising = {
  readonly status: 'summarising'
  readonly thread_id: string | null
}

export type SummaryOutcome = SummaryResult | SummarySummarising

export function isSummarising(outcome: SummaryOutcome): outcome is SummarySummarising {
  return 'status' in outcome && outcome.status === 'summarising'
}

const HOST_SUMMARY = 'studio:sandbox:summary'
const HOST_SUMMARY_RESULT = 'studio:sandbox:summary-result'
const HOST_TIMEOUT_MS = 60_000
let nextRequestId = 0

type HostReply = {
  type?: string
  requestId?: string
  ok?: boolean
  result?: SummaryOutcome
  error?: { code?: string; message?: string; status?: number }
}

function viaHost(panels: readonly PanelReport[], signal?: AbortSignal): Promise<SummaryOutcome> {
  const requestId = `u${(nextRequestId += 1)}`
  return new Promise<SummaryOutcome>((resolve, reject) => {
    const settle = (run: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      run()
    }
    const onMessage = (event: MessageEvent<HostReply>) => {
      const reply = event.data
      if (reply?.type !== HOST_SUMMARY_RESULT || reply.requestId !== requestId) return
      if (reply.ok === true && reply.result !== undefined) {
        settle(() => resolve(reply.result as SummaryOutcome))
        return
      }
      const error = reply.error ?? {}
      settle(() => reject(new BdaError(error.code ?? 'request_failed', error.message ?? 'The host could not summarise this app.', error.status ?? 0)))
    }
    const onAbort = () => settle(() => reject(new BdaError('aborted', 'The summary request was cancelled.', 0)))
    const timer = window.setTimeout(() => settle(() => reject(new BdaError('host_timeout', 'The host did not answer the summary request.', 0))), HOST_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort)
    window.parent.postMessage({ type: HOST_SUMMARY, requestId, context: panels }, '*')
  })
}

async function toError(response: Response): Promise<BdaError> {
  let code = 'request_failed'
  let message = `The request failed with status ${response.status}.`
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // A non-JSON body (a proxy error page, say) leaves the defaults.
  }
  return new BdaError(code, message, response.status)
}

/** Development only: `POST {apiBase}/data-apps/{appId}/summary` directly. */
async function direct(panels: readonly PanelReport[], signal?: AbortSignal): Promise<SummaryOutcome> {
  const { apiBase, appId, token } = context()
  const response = await fetch(`${apiBase}/data-apps/${encodeURIComponent(appId)}/summary`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ context: panels }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status === 202) {
    const body = (await response.json()) as { thread_id?: string | null }
    return { status: 'summarising', thread_id: body.thread_id ?? null }
  }
  if (!response.ok) throw await toError(response)
  return (await response.json()) as SummaryResult
}

/**
 * Ask for this app's summary, given the panels currently on screen (as
 * `contextRegistry.ts` reports them). Resolves to a finished `SummaryResult`
 * or a `SummarySummarising` the caller should retry after a short delay —
 * never throws for that case, only for a real failure (`BdaError`).
 */
export function requestSummary(panels: readonly PanelReport[], signal?: AbortSignal): Promise<SummaryOutcome> {
  return window.parent !== window ? viaHost(panels, signal) : direct(panels, signal)
}
