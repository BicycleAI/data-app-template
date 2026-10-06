import { describe, expect, it } from 'vitest'
import { MAX_RETRIES, retryDelay, shouldRetry } from './hooks.js'
import { BdaError } from './types.js'

describe('query retry policy', () => {
  it('retries a timeout or a server failure, up to three tries in all, with backoff', () => {
    const timeout = new BdaError('host_timeout', 'The host did not answer the query.', 0)
    const bad = new BdaError('upstream_failed', 'Bad gateway', 502)
    expect(shouldRetry(0, timeout)).toBe(true)
    expect(shouldRetry(1, bad)).toBe(true)
    expect(shouldRetry(MAX_RETRIES, bad)).toBe(false)
    expect(MAX_RETRIES + 1).toBe(3)
    expect([0, 1, 2, 5].map(retryDelay)).toEqual([1000, 2000, 4000, 8000])
  })

  it('does not retry a refused, expired or cancelled query', () => {
    expect(shouldRetry(0, new BdaError('query_not_allowed', 'not declared', 403))).toBe(false)
    expect(shouldRetry(0, new BdaError('token_expired', 'expired', 401))).toBe(false)
    expect(shouldRetry(0, new BdaError('aborted', 'cancelled', 0))).toBe(false)
  })
})
