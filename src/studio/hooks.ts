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
import { fetchSummary, runQuery } from './client.js'
import { context } from './context.js'
import type { AppSummary, BdaError, QueryOptions, QueryResult } from './types.js'

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
    retry: (attempt, error) => {
      // A refused query or an expired token does not fix itself by retrying;
      // only a server-side failure is worth a second attempt.
      if (error.status < 500) return false
      return attempt < 2
    },
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

/**
 * The AI summary an agent published for this app.
 *
 * `data` is `null` — not `undefined` — when no summary exists, so a caller can
 * tell "still loading" from "there is nothing to show" and render the card only
 * in the second case.
 *
 * Longer `staleTime` than a query on purpose: a summary changes when a person
 * runs the studio's summary tools, not when the data moves, so refetching it on
 * the cadence of a chart would be pure noise.
 */
export function useAppSummary(
  options: { checkStale?: boolean; enabled?: boolean } = {},
): UseQueryResult<AppSummary | null, BdaError> {
  const { appId } = context()
  const { checkStale = true, enabled = true } = options

  return useQuery<AppSummary | null, BdaError>({
    queryKey: ['bda', appId, 'summary', checkStale],
    queryFn: ({ signal }) => fetchSummary(checkStale, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: (attempt, error) => (error.status < 500 ? false : attempt < 2),
  })
}
