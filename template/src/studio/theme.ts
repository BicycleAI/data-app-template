/**
 * Light or dark, and who decides.
 *
 * The default is the viewer's operating system. Nothing here reads a stored
 * preference and nothing shows a toggle: the app runs in a frame with no
 * storage, and a data app is a page someone was sent, not a place they visit
 * often enough to configure.
 *
 * The resolved theme lives in one place — `data-theme` on `<html>` — because
 * CSS is what consumes it. `theme.css` defines the light palette on `:root`
 * and the dark one under `:root[data-theme='dark']`, so stamping that
 * attribute is the whole mechanism.
 *
 * Precedence, highest first:
 *
 *   1. `pinTheme('dark')` — the app itself, because the person who asked for
 *      it said which one they wanted.
 *   2. `?theme=dark` on the embed URL — the host was told which one to use.
 *   3. `prefers-color-scheme` — the default, and it keeps following the system
 *      if the viewer changes it while the page is open.
 */

export type Theme = 'light' | 'dark'

/** A request for a theme. `'system'` means follow `prefers-color-scheme`. */
export type ThemePreference = Theme | 'system'

const DARK = '(prefers-color-scheme: dark)'

let preference: ThemePreference = 'system'
let pinned = false
let following = false
const listeners = new Set<(theme: Theme) => void>()

/**
 * The system preference, as one long-lived object.
 *
 * Held in a module variable on purpose. A `MediaQueryList` nothing else
 * references is collectable, and its `change` listener goes with it — so
 * `window.matchMedia(q).addEventListener(…)` fires for a while and then
 * silently stops. It cost an hour: the first switch worked and the second did
 * not. `null` means the browser has no media queries to ask.
 */
let query: MediaQueryList | null | undefined

function media(): MediaQueryList | null {
  if (query === undefined) {
    query =
      typeof window === 'undefined' || typeof window.matchMedia !== 'function'
        ? null
        : window.matchMedia(DARK)
  }
  return query
}

/** What the system asks for. Light when there is nothing to ask. */
export function systemTheme(): Theme {
  return media()?.matches === true ? 'dark' : 'light'
}

function resolve(): Theme {
  return preference === 'system' ? systemTheme() : preference
}

function apply(): void {
  const theme = resolve()
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  for (const listener of listeners) listener(theme)
}

/**
 * Start following the theme. Called once by `initContext`.
 *
 * `hostPreference` is what the embed URL asked for, or `'system'` when it
 * asked for nothing — which is the normal case.
 */
export function initTheme(hostPreference: ThemePreference = 'system'): Theme {
  if (!pinned) preference = hostPreference
  apply()

  // Follow the system for as long as the page is open. There is no removal
  // path on purpose: the listener lives exactly as long as the document. It is
  // attached once, so calling this twice does not double up.
  const list = media()
  if (list !== null && !following) {
    following = true
    list.addEventListener('change', () => {
      if (preference === 'system') apply()
    })
  }

  return resolve()
}

/**
 * Force a theme, ignoring the system.
 *
 * Use this when the app was asked for one — "make it dark" — and call it from
 * `main.tsx` before rendering. `pinTheme('system')` hands control back.
 */
export function pinTheme(next: ThemePreference): Theme {
  preference = next
  pinned = true
  apply()
  return resolve()
}

/** The theme in effect right now. */
export function currentTheme(): Theme {
  return resolve()
}

/**
 * Observe the theme.
 *
 * Anything that reads a colour in JavaScript rather than in CSS has to
 * re-read it when this fires — `Chart` does, because Plot needs resolved
 * colour values.
 */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test seam. Resets module state between cases. */
export function resetThemeForTests(): void {
  preference = 'system'
  pinned = false
  following = false
  query = undefined
  listeners.clear()
}
