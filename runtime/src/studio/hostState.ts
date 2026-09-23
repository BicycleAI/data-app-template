/**
 * Where a deep link lands (T9.0).
 *
 * The host turns a link — `?filters=…&time=30d&asOf=…`, a scheduled capture,
 * a "show me this panel" from chat — into one `state` object and injects it
 * with the rest of the embed context, before this bundle loads. This module
 * is the only place that reads it, so everything downstream (`controls.tsx`,
 * `App.tsx`) takes it as a plain argument and stays testable without a host.
 *
 * Nothing here fetches, and nothing here decides *what* the state means —
 * validating it against the spec is `controls.tsx`'s `applyRenderState`, and
 * announcing what was adopted is `contextRegistry.ts`'s `reportState`.
 */

import type { RenderState } from './types.js'

declare global {
  interface Window {
    /** Development only (`npm run dev`): the deep-link state an embed page would otherwise inject. Set it in `runtime/public/dev-spec.js`. */
    __BDA_RENDER_STATE?: RenderState
  }
}

/** The class a capture-mode page carries on `<html>`. Paired with the `.kit-snapshot` rules in `theme.css`. */
export const SNAPSHOT_CLASS = 'kit-snapshot'

/**
 * What the host asked for, or `{}` when it asked for nothing (or framed this
 * bundle with an embed page older than the field).
 *
 * Reads `window.__BDA_CONTEXT` directly rather than going through
 * `context()`: a recipe fixture or a test renders without `initContext()`
 * having run, and a missing deep link is the normal case, not an error.
 */
export function renderState(): RenderState {
  if (typeof window === 'undefined') return {}
  // `__BDA_RENDER_STATE` is the `npm run dev` seam: there is no embed page to
  // inject a context, so `runtime/public/dev-spec.js` sets the state a link
  // would have carried. Inside `import.meta.env.DEV`, so it disappears from a
  // production bundle entirely — the same shape `context.ts` uses.
  const state = window.__BDA_CONTEXT?.state ?? (import.meta.env.DEV ? window.__BDA_RENDER_STATE : undefined)
  return state === undefined || state === null || typeof state !== 'object' ? {} : state
}

/**
 * Presentation-only (contract 4): a capture should show the data and the
 * filters that produced it, not the affordances a person would have clicked.
 * One class on the document root; the rules that act on it live in
 * `theme.css`, so nothing is conditionally rendered and the DOM a snapshot
 * captures is the same DOM a viewer sees.
 */
export function applySnapshotClass(snapshot: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(SNAPSHOT_CLASS, snapshot)
}
