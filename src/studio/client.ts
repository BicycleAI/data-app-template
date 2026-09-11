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
