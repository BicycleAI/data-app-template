/**
 * The only way this app reaches data.
 *
 * There is no SQL here and no table names — just a query id the manifest
 * declared, plus parameters, filters and sorting the service checks against
 * that declaration. Everything else about the request is fixed.
 */

import { context } from './context.js'
import { BdaError, type QueryOptions, type QueryResult } from './types.js'

type ErrorEnvelope = { error?: { code?: unknown; message?: unknown; status?: unknown } }

async function toError(response: Response): Promise<BdaError> {
  let code = 'request_failed'
  let message = `The request failed with status ${response.status}.`
  try {
    const body = (await response.json()) as ErrorEnvelope
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // A non-JSON body (a proxy error page, say) leaves the defaults.
  }
  return new BdaError(code, message, response.status)
}

/**
 * Run one declared query.
 *
 * The token is read at call time rather than captured, so a re-mint mid-session
 * is picked up by the next request without anything being rebuilt.
 */
export async function runQuery(
  queryId: string,
  options: QueryOptions = {},
  signal?: AbortSignal,
): Promise<QueryResult> {
  // Hosted, the app runs in a frame sandboxed without allow-same-origin, so its origin is opaque
  // and every fetch it makes is cross-origin with `Origin: null` — refused before it leaves the
  // page. The host asks on our behalf instead. In `npm run dev` there is no host, so the direct
  // fetch below is used.
  if (window.parent !== window) return queryViaHost(queryId, options, signal)

  const { apiBase, appId, token } = context()

  const response = await fetch(`${apiBase}/data-apps/${encodeURIComponent(appId)}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      queryId,
      ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
      ...(options.filters === undefined ? {} : { filters: options.filters }),
      ...(options.sort === undefined ? {} : { sort: options.sort }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }),
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) throw await toError(response)
  return (await response.json()) as QueryResult
}

const HOST_QUERY = 'studio:sandbox:query'
const HOST_QUERY_RESULT = 'studio:sandbox:query-result'
const HOST_TIMEOUT_MS = 60_000

type HostReply = {
  type?: string
  requestId?: string
  ok?: boolean
  result?: QueryResult
  error?: { code?: string; message?: string; status?: number }
}

let nextRequestId = 0

/**
 * Ask the host page to run the query.
 *
 * The host owns the credential and the origin; this side only names a query id, exactly as it
 * would over HTTP. Errors come back as a code so callers can still branch on `token_expired` and
 * the rest without knowing which transport was used.
 */
function queryViaHost(
  queryId: string,
  options: QueryOptions,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const requestId = `q${(nextRequestId += 1)}`

  return new Promise<QueryResult>((resolve, reject) => {
    const settle = (run: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      run()
    }

    const onMessage = (event: MessageEvent<HostReply>) => {
      const reply = event.data
      if (reply?.type !== HOST_QUERY_RESULT || reply.requestId !== requestId) return
      if (reply.ok === true && reply.result !== undefined) {
        settle(() => resolve(reply.result as QueryResult))
        return
      }
      const error = reply.error ?? {}
      settle(() =>
        reject(
          new BdaError(
            error.code ?? 'request_failed',
            error.message ?? 'The host could not run the query.',
            error.status ?? 0,
          ),
        ),
      )
    }

    const onAbort = () =>
      settle(() => reject(new BdaError('aborted', 'The query was cancelled.', 0)))

    const timer = window.setTimeout(
      () =>
        settle(() =>
          reject(new BdaError('host_timeout', 'The host did not answer the query.', 0)),
        ),
      HOST_TIMEOUT_MS,
    )

    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort)
    window.parent.postMessage({ type: HOST_QUERY, requestId, queryId, options }, '*')
  })
}

/**
 * Rows as objects, keyed by column name.
 *
 * The wire format is columns plus row arrays, which is compact but awkward to
 * render. Every app needs this, so it ships rather than being reinvented.
 */
export function toObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const object: Record<string, unknown> = {}
    result.columns.forEach((column, index) => {
      object[column.name] = row[index]
    })
    return object
  })
}
