/**
 * The app's store: a small shared cache and read-only blobs, both scoped to
 * this app in this tenant by the service.
 *
 * The frame has no origin and no network, so — exactly like queries — every
 * operation is a message to the host page, which calls the API on the app's
 * behalf. In `npm run dev` there is no host and the client calls the API
 * directly. Only what `bda.manifest.json` declares is served: a blob name
 * not in `blobs` or a cache op on an app without `cache` is refused with
 * `store_not_declared`.
 *
 *   cache.get(key)                 -> value | undefined
 *   cache.set(key, value, ttl?)    -> void         (JSON, ≤ max_value_bytes)
 *   cache.delete(key)              -> void
 *   blobs.list()                   -> names
 *   blobs.json(name)               -> parsed JSON
 *   blobs.text(name)               -> string
 *   blobs.bytes(name)              -> ArrayBuffer  (models, parquet, images)
 */

import { context } from './context.js'
import { BdaError } from './types.js'

type Op = 'cache.get' | 'cache.set' | 'cache.delete' | 'blob.get' | 'blob.list'

type Request = {
  readonly op: Op
  readonly key?: string
  readonly value?: unknown
  readonly ttlSeconds?: number
  readonly name?: string
}

type Result = {
  readonly found?: boolean
  readonly value?: unknown
  readonly names?: readonly string[]
  readonly bytes?: ArrayBuffer
  readonly contentType?: string
}

const HOST_STORE = 'studio:sandbox:store'
const HOST_STORE_RESULT = 'studio:sandbox:store-result'
const HOST_TIMEOUT_MS = 60_000
let nextRequestId = 0

type HostReply = { type?: string; requestId?: string; ok?: boolean; result?: Result; error?: { code?: string; message?: string; status?: number } }

function viaHost(request: Request, signal?: AbortSignal): Promise<Result> {
  const requestId = `s${(nextRequestId += 1)}`
  return new Promise<Result>((resolve, reject) => {
    const settle = (run: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      run()
    }
    const onMessage = (event: MessageEvent<HostReply>) => {
      const reply = event.data
      if (reply?.type !== HOST_STORE_RESULT || reply.requestId !== requestId) return
      if (reply.ok === true) settle(() => resolve(reply.result ?? {}))
      else settle(() => reject(new BdaError(reply.error?.code ?? 'request_failed', reply.error?.message ?? 'The host could not reach the store.', reply.error?.status ?? 0)))
    }
    const onAbort = () => settle(() => reject(new BdaError('aborted', 'The store request was cancelled.', 0)))
    const timer = window.setTimeout(() => settle(() => reject(new BdaError('host_timeout', 'The host did not answer the store request.', 0))), HOST_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort)
    window.parent.postMessage({ type: HOST_STORE, requestId, ...request }, '*')
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
    // non-JSON body
  }
  return new BdaError(code, message, response.status)
}

/** Development only: the same operations against the API directly. */
async function direct(request: Request, signal?: AbortSignal): Promise<Result> {
  const { apiBase, appId, token } = context()
  const base = `${apiBase}/data-apps/${encodeURIComponent(appId)}`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const init = signal === undefined ? {} : { signal }
  switch (request.op) {
    case 'cache.get': {
      const response = await fetch(`${base}/cache/${encodeURIComponent(request.key ?? '')}`, { headers, ...init })
      if (response.status === 404) return { found: false }
      if (!response.ok) throw await toError(response)
      return { found: true, value: (await response.json()).value }
    }
    case 'cache.set': {
      const response = await fetch(`${base}/cache/${encodeURIComponent(request.key ?? '')}`, { method: 'PUT', headers, body: JSON.stringify({ value: request.value, ttlSeconds: request.ttlSeconds }), ...init })
      if (!response.ok) throw await toError(response)
      return {}
    }
    case 'cache.delete': {
      const response = await fetch(`${base}/cache/${encodeURIComponent(request.key ?? '')}`, { method: 'DELETE', headers, ...init })
      if (!response.ok && response.status !== 404) throw await toError(response)
      return {}
    }
    case 'blob.list': {
      const response = await fetch(`${base}/blobs`, { headers, ...init })
      if (!response.ok) throw await toError(response)
      return { names: ((await response.json()).blobs as { name: string }[]).map((blob) => blob.name) }
    }
    case 'blob.get': {
      const response = await fetch(`${base}/blobs/${encodeURIComponent(request.name ?? '')}`, { headers: { authorization: headers.authorization }, ...init })
      if (!response.ok) throw await toError(response)
      return { bytes: await response.arrayBuffer(), contentType: response.headers.get('content-type') ?? 'application/octet-stream' }
    }
  }
}

const send = (request: Request, signal?: AbortSignal) => (window.parent !== window ? viaHost(request, signal) : direct(request, signal))

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const cache = {
  async get<T = unknown>(key: string, signal?: AbortSignal): Promise<T | undefined> {
    if (!KEY.test(key)) throw new BdaError('bad_key', `cache key "${key}" must match ${KEY}`, 0)
    const result = await send({ op: 'cache.get', key }, signal)
    return result.found === true ? (result.value as T) : undefined
  },
  async set(key: string, value: unknown, ttlSeconds?: number, signal?: AbortSignal): Promise<void> {
    if (!KEY.test(key)) throw new BdaError('bad_key', `cache key "${key}" must match ${KEY}`, 0)
    await send({ op: 'cache.set', key, value, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) }, signal)
  },
  async delete(key: string, signal?: AbortSignal): Promise<void> {
    await send({ op: 'cache.delete', key }, signal)
  },
}

const decoder = new TextDecoder()

export const blobs = {
  async list(signal?: AbortSignal): Promise<readonly string[]> {
    return (await send({ op: 'blob.list' }, signal)).names ?? []
  },
  async bytes(name: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const result = await send({ op: 'blob.get', name }, signal)
    if (result.bytes === undefined) throw new BdaError('empty_blob', `blob "${name}" came back empty`, 0)
    return result.bytes
  },
  async text(name: string, signal?: AbortSignal): Promise<string> {
    return decoder.decode(await blobs.bytes(name, signal))
  },
  async json<T = unknown>(name: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await blobs.text(name, signal)) as T
  },
}
