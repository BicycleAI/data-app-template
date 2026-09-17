/**
 * Where the app learns who it is.
 *
 * In the embed page the context is already on `window`, injected before this
 * module loads. In `npm run dev` there is no embed page, so it is assembled
 * from the manifest and an environment variable — that branch is inside
 * `import.meta.env.DEV` so it disappears from a production bundle entirely.
 *
 * The token can change while the app is running: the host re-mints before
 * expiry and swaps it into the URL fragment, which arrives as a `hashchange`.
 * Nothing above this module has to know that happened.
 */

import { initTheme } from './theme.js'
import type { BdaContext } from './types.js'

let current: BdaContext | undefined
const listeners = new Set<(token: string) => void>()

function readFragmentToken(): { token: string; expiresAt: string } | undefined {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.length === 0) return undefined
  const params = new URLSearchParams(hash)
  const token = params.get('vt')
  if (token === null) return undefined
  return { token, expiresAt: params.get('exp') ?? new Date(Date.now() + 600_000).toISOString() }
}

export async function initContext(): Promise<BdaContext> {
  if (current !== undefined) return current

  const injected = window.__BDA_CONTEXT
  if (injected !== undefined) {
    current = injected
  } else if (import.meta.env.DEV) {
    // Development only. Never reached in a built bundle.
    const manifest = (await import('../../bda.manifest.json')) as { default: { appId?: string } }
    const appId = manifest.default.appId ?? ''
    if (appId.length === 0) {
      throw new Error(
        'bda.manifest.json has no appId. Create the app through the CRUD API first, then put its id there.',
      )
    }
    const token = import.meta.env.VITE_BDA_TOKEN ?? ''
    if (token.length === 0) {
      throw new Error('VITE_BDA_TOKEN is not set. Mint a view token — see .env.example.')
    }
    current = {
      v: 1,
      appId,
      version: 1,
      apiBase: '/api',
      token,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      // Resolved by `initTheme` below, like every other path.
      theme: 'light',
      themePreference: 'system',
    }
  } else {
    throw new Error('This app was loaded outside its host page and has no context.')
  }

  // Light or dark follows the viewer's system unless the host or the app
  // asked for one. This stamps `data-theme` and keeps following it.
  current = { ...current, theme: initTheme(current.themePreference) }

  // The host swaps a fresh token into the fragment rather than reloading the
  // frame, so app state and cached query results survive a re-mint.
  window.addEventListener('hashchange', () => {
    const refreshed = readFragmentToken()
    if (refreshed === undefined || current === undefined) return
    current = { ...current, token: refreshed.token, expiresAt: refreshed.expiresAt }
    for (const listener of listeners) listener(refreshed.token)
  })

  return current
}

export function context(): BdaContext {
  if (current === undefined) throw new Error('initContext() has not completed yet.')
  return current
}

/** Observe token replacement. Used by the client; apps rarely need it. */
export function onTokenChange(listener: (token: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
