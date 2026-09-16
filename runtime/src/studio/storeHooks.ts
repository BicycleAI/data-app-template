/**
 * React hooks over the store. Declared-ness is checked here so a recipe can
 * call them unconditionally: an undeclared blob or cache resolves to
 * `undefined` instead of a refused request.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Spec } from '../spec.js'
import { blobs, cache } from './store.js'
import type { BdaError } from './types.js'

export type StoreState<T> = { readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly value: T | undefined; readonly error: BdaError | undefined }

export function blobDeclared(spec: Spec, name: string | undefined): boolean {
  return name !== undefined && (spec.store?.blobs ?? []).some((blob) => blob.name === name)
}

export function cacheDeclared(spec: Spec): boolean {
  return spec.store?.cache !== undefined
}

/** A declared JSON blob, fetched once per name. */
export function useBlobJson<T = unknown>(spec: Spec, name: string | undefined): StoreState<T> {
  const declared = blobDeclared(spec, name)
  const [state, setState] = useState<StoreState<T>>({ status: declared ? 'loading' : 'idle', value: undefined, error: undefined })
  useEffect(() => {
    if (!declared || name === undefined) return
    const controller = new AbortController()
    setState({ status: 'loading', value: undefined, error: undefined })
    blobs
      .json<T>(name, controller.signal)
      .then((value) => setState({ status: 'ready', value, error: undefined }))
      .catch((error: BdaError) => {
        if (error.code !== 'aborted') setState({ status: 'error', value: undefined, error })
      })
    return () => controller.abort()
  }, [declared, name])
  return state
}

/**
 * A shared value in the app's cache. Reads once; `set` writes through and
 * updates local state, so every viewer converges on the last write.
 */
export function useShared<T>(spec: Spec, key: string): [StoreState<T>, (value: T) => Promise<void>] {
  const declared = cacheDeclared(spec)
  const [state, setState] = useState<StoreState<T>>({ status: declared ? 'loading' : 'idle', value: undefined, error: undefined })
  useEffect(() => {
    if (!declared) return
    const controller = new AbortController()
    cache
      .get<T>(key, controller.signal)
      .then((value) => setState({ status: 'ready', value, error: undefined }))
      .catch((error: BdaError) => {
        if (error.code !== 'aborted') setState({ status: 'error', value: undefined, error })
      })
    return () => controller.abort()
  }, [declared, key])
  const set = useCallback(
    async (value: T) => {
      if (!declared) return
      await cache.set(key, value, spec.store?.cache?.ttl_seconds)
      setState({ status: 'ready', value, error: undefined })
    },
    [declared, key, spec.store?.cache?.ttl_seconds],
  )
  return [state, set]
}

/**
 * A locally computed value, memoised in the app's shared cache when one is
 * declared. Always returns synchronously: the first render (and every render
 * before a lookup lands, or if the store errs) gets `compute()`'s own result,
 * a cache hit only ever replaces it on a later render, and the miss path
 * writes the computed value back without the caller waiting on it.
 *
 * Store failures never surface here — no error is exposed, `compute()`'s
 * result is simply what the caller gets (see AGENTS.md: "Store misses …
 * render as a muted note, never an error card").
 */
export function useMemoised<T>(spec: Spec, key: string, compute: () => T, deps: readonly unknown[]): T {
  const declared = cacheDeclared(spec)
  // The synchronous fallback: always fresh, recomputed only when `deps` change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const local = useMemo(compute, deps)
  const [cached, setCached] = useState<{ key: string; value: T } | undefined>(undefined)

  useEffect(() => {
    if (!declared) return
    let cancelled = false
    cache
      .get<T>(key)
      .then((hit) => {
        if (cancelled) return
        if (hit !== undefined) setCached({ key, value: hit })
        else void cache.set(key, local, spec.store?.cache?.ttl_seconds).catch(() => {})
      })
      .catch(() => {
        // A store error just means this render keeps using `local` — never surfaced.
      })
    return () => {
      cancelled = true
    }
    // `local` is read only inside the miss branch above, fire-and-forget; the
    // lookup itself only needs to re-run when declared-ness or the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declared, key])

  if (declared && cached !== undefined && cached.key === key) return cached.value
  return local
}
