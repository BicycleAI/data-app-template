/**
 * Data fetching, on TanStack Query.
 *
 * The choice earns itself on the filter-and-sort path: the query key carries
 * the parameters, filters and sort, so changing a filter is a new key and
 * refetches on its own, while `keepPreviousData` holds the current rows on
 * screen instead of flashing a spinner. Caching, dedupe and request
 * cancellation come with it.
 */

import { keepPreviousData, QueryClient, type UseQueryResult, useQuery } from '@tanstack/react-query'
import { runQuery } from './client.js'
import { context } from './context.js'
import type { BdaError, QueryOptions, QueryResult } from './types.js'

/**
 * A stable string for any option value.
 *
 * `JSON.stringify` preserves key insertion order, so `{a:1,b:2}` and
 * `{b:2,a:1}` would be two different cache keys for one query. Sorting makes
 * the key depend on meaning rather than on how the object was built.
 */
export function stableKey(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(nested as Record<string, unknown>).sort()) {
      sorted[key] = (nested as Record<string, unknown>)[key]
    }
    return sorted
  })
}

/** Tries after the first: three in all, so a redeploy's few seconds of 502s or host timeouts pass unseen. */
export const MAX_RETRIES = 2

/**
 * Retry what is transient — a server-side failure (5xx), or no answer at all
 * (status 0: `host_timeout`, a dropped connection) — and never what is not:
 * a refused query, an expired token (4xx) or a cancelled one. What still
 * fails shows "Couldn't load" with Retry, never a number.
 */
export function shouldRetry(failures: number, error: BdaError): boolean {
  if (failures >= MAX_RETRIES) return false
  if (error.code === 'aborted') return false
  return error.status >= 500 || error.status === 0
}

/** Backoff between tries: 1 s, then 2 s (capped at 8 s). */
export function retryDelay(failures: number): number {
  return Math.min(1000 * 2 ** failures, 8000)
}

export function useAppQuery(
  queryId: string,
  options: QueryOptions & { enabled?: boolean } = {},
): UseQueryResult<QueryResult, BdaError> {
  const { appId } = context()
  const { enabled = true, ...query } = options

  return useQuery<QueryResult, BdaError>({
    queryKey: [
      'bda',
      appId,
      queryId,
      stableKey(query.parameters),
      stableKey(query.filters),
      stableKey(query.sort),
      query.limit ?? null,
    ],
    queryFn: ({ signal }) => runQuery(queryId, query, signal),
    enabled,
    // Keep the previous rows visible while a filter change refetches.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: shouldRetry,
    retryDelay: retryDelay,
  })
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // An iframe gains and loses focus as the page around it is used, which
        // would otherwise cause a burst of pointless refetches.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  })
}
