/**
 * The data path a generated app depends on.
 *
 * Two things are worth pinning here. The query key has to depend on meaning
 * rather than object identity, or a filter change either misses the cache or
 * never refetches. And a header click has to actually reach the service with
 * a `sort` — the service is what decides whether a column may be sorted on, so
 * a component that sorts locally would silently disagree with it.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from '../components/DataTable.js'
import { fetchSummary, runQuery, toObjects } from './client.js'
import { initContext } from './context.js'
import { createQueryClient, stableKey } from './hooks.js'
import type { AppSummary, QueryResult } from './types.js'

const RESULT: QueryResult = {
  columns: [
    { name: 'sales_region', type: 'string' },
    { name: 'total_revenue', type: 'number' },
  ],
  rows: [
    ['North', 26_649.75],
    ['East', 23_341],
  ],
  meta: { rowCount: 2, truncated: false },
}

/** The context the embed page injects, without an embed page. */
function installContext(): void {
  window.__BDA_CONTEXT = {
    v: 1,
    appId: `app_${'a'.repeat(32)}`,
    version: 1,
    apiBase: '/api',
    token: 'bdav_test',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    theme: 'light',
    themePreference: 'system',
  }
}

type Sent = { url: string; body: Record<string, unknown> }

function stubFetch(result: QueryResult = RESULT): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> })
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return sent
}

// Testing Library registers its own cleanup only when vitest globals are on,
// and they are not — so a rendered tree would otherwise persist and make
// `getByText` ambiguous in the next test.
afterEach(() => {
  cleanup()
})

beforeEach(async () => {
  vi.unstubAllGlobals()
  installContext()
  // `context()` reads what `initContext()` resolved, not the global directly,
  // so the boot the embed page performs has to happen here too.
  await initContext()
})

describe('the query key', () => {
  it('does not depend on the order keys were written in', () => {
    // Otherwise two identical filter objects are two cache entries, and the
    // app refetches on every render that rebuilds the object.
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }))
  })

  it('still distinguishes different values', () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }))
    expect(stableKey([{ field: 'x', op: 'eq', value: 1 }])).not.toBe(
      stableKey([{ field: 'x', op: 'eq', value: 2 }]),
    )
  })

  it('treats an absent option as absent, not as null', () => {
    expect(stableKey(undefined)).toBe('')
  })
})

describe('the client', () => {
  it('sends the view token and the declared query id', async () => {
    const sent = stubFetch()
    await runQuery('revenue_by_region', { parameters: { since: '2026-01-01' } })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`/api/data-apps/${window.__BDA_CONTEXT?.appId}/query`)
    expect(sent[0]?.body).toEqual({ queryId: 'revenue_by_region', parameters: { since: '2026-01-01' } })
  })

  it('omits options that were not given, rather than sending nulls', async () => {
    const sent = stubFetch()
    await runQuery('revenue_by_region')
    expect(Object.keys(sent[0]?.body ?? {})).toEqual(['queryId'])
  })

  it('turns the error envelope into a code an app can branch on', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'query_not_allowed', message: 'Not declared.' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(runQuery('nope')).rejects.toMatchObject({
      code: 'query_not_allowed',
      status: 403,
      message: 'Not declared.',
    })
  })

  it('survives a non-JSON failure, such as a proxy error page', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }))
    await expect(runQuery('x')).rejects.toMatchObject({ code: 'request_failed', status: 502 })
  })

  it('zips rows into objects by column name', () => {
    expect(toObjects(RESULT)).toEqual([
      { sales_region: 'North', total_revenue: 26_649.75 },
      { sales_region: 'East', total_revenue: 23_341 },
    ])
  })
})

describe('the sample table', () => {
  function mount(sent: Sent[]) {
    const client = createQueryClient()
    return {
      sent,
      ...render(
        <QueryClientProvider client={client}>
          <DataTable
            queryId="revenue_by_region"
            columns={[
              { field: 'sales_region', label: 'Region' },
              { field: 'total_revenue', label: 'Revenue', numeric: true },
            ]}
          />
        </QueryClientProvider>,
      ),
    }
  }

  it('renders the rows the service returned', async () => {
    mount(stubFetch())
    await waitFor(() => expect(screen.getByText('North')).toBeDefined())
    expect(screen.getByText('26,649.75')).toBeDefined()
  })

  it('asks the service to sort when a header is clicked', async () => {
    // The service owns sorting because it owns the allow-list of columns. A
    // table that reordered rows locally would look right and disagree with
    // what the service would permit.
    const { sent } = mount(stubFetch())
    await waitFor(() => expect(screen.getByText('North')).toBeDefined())
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body.sort).toBeUndefined()

    const header = screen.getByText('Revenue')
    await act(async () => {
      header.click()
    })

    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]?.body.sort).toEqual([{ field: 'total_revenue', dir: 'desc' }])
  })

  it('reverses the direction on a second click', async () => {
    const { sent } = mount(stubFetch())
    await waitFor(() => expect(screen.getByText('North')).toBeDefined())

    const header = screen.getByText('Revenue')
    await act(async () => {
      header.click()
    })
    await waitFor(() => expect(sent).toHaveLength(2))
    await act(async () => {
      header.click()
    })
    await waitFor(() => expect(sent).toHaveLength(3))
    expect(sent[2]?.body.sort).toEqual([{ field: 'total_revenue', dir: 'asc' }])
  })

  it('says plainly that nothing matched, rather than showing an empty frame', async () => {
    mount(stubFetch({ ...RESULT, rows: [], meta: { rowCount: 0, truncated: false } }))
    await waitFor(() => expect(screen.getByText('No rows matched.')).toBeDefined())
  })

  it('shows the service’s message when a query is refused', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'query_not_allowed', message: 'Not declared.' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <DataTable queryId="missing" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Not declared.'))
  })
})

describe('the summary', () => {
  const PUBLISHED: AppSummary = {
    headline: 'NetBanking is the only method below 75%',
    bullets: ['NetBanking converted at 73.0% against 75.9% overall'],
    range: { from: '2026-06-17', to: '2026-07-17' },
    generatedAt: '2026-07-17T11:42:00Z',
    generatedBy: 'u-alice',
    writer: 'claude-opus-5',
    factsDigest: 'abc123',
    stale: false,
  }

  it('reads 204 as "no summary", not as a failure', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    // A card that treated this as an error would show one on almost every app.
    await expect(fetchSummary()).resolves.toBeNull()
  })

  it('sends the view token and asks for a staleness check by default', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push(String(url))
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer bdav_test')
      return new Response(JSON.stringify(PUBLISHED), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const summary = await fetchSummary()
    expect(summary?.headline).toBe(PUBLISHED.headline)
    expect(seen[0]).toContain(`/api/data-apps/app_${'a'.repeat(32)}/summary?stale=true`)

    await fetchSummary(false)
    expect(seen[1]).toContain('stale=false')
  })

  it('turns a refusal into a code an app can branch on', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Not yours.' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(fetchSummary()).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })
})
