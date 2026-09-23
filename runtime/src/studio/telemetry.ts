/**
 * The frame's telemetry reporter.
 *
 * The app cannot reach an analytics service itself. The frame is sandboxed
 * without `allow-same-origin` and its CSP is `connect-src 'none'`, so a
 * tracker's script and every beacon it would send are refused — a session
 * replay of the host page shows a blank rectangle where this app draws. The
 * host records instead: this module posts `studio:sandbox:telemetry`, and the
 * embedder forwards it to whatever it is wired to. Which tracker that is, and
 * whether there is one at all, is the host's business and deliberately not
 * this module's.
 *
 * Three rules follow from that, and they are the whole design:
 *
 *   1. Fire and forget. There is no request id and no reply, like
 *      `studio:sandbox:context`. An app must never be able to block, retry or
 *      branch on whether the host is recording — it is not told.
 *   2. Structure, not data. `report()` carries what happened; observed numbers
 *      go in the separate `values` bag, which the host drops unless the
 *      manifest declared `telemetry.values`. Splitting them here rather than
 *      leaving it to the host means the app states which is which, at the call
 *      site, where it is obvious.
 *   3. What is on screen is already reported. `contextRegistry` posts every
 *      panel, its bindings and its digest on every change. This is for the
 *      things a context report cannot express: a click, a filter change, an
 *      export — moments rather than states.
 *
 * The host bounds everything that arrives (name charset, property count, value
 * types, rate limit), so nothing here needs to be defensive on its behalf. It
 * is worth knowing the shape it enforces: a dotted lower-case name, at most 20
 * flat scalar properties, 60 events a minute.
 */

const HOST_TELEMETRY = 'studio:sandbox:telemetry'

/** Flat and JSON-serialisable. The host drops anything else. */
export type TelemetryValue = string | number | boolean | null

export type TelemetryMessage = {
  readonly type: typeof HOST_TELEMETRY
  readonly name: string
  readonly properties?: Readonly<Record<string, TelemetryValue>>
  readonly values?: Readonly<Record<string, TelemetryValue>>
}

/**
 * Report one thing that happened.
 *
 * `name` is a dotted namespace in the app's own vocabulary — `filter.changed`,
 * `panel.expanded`, `table.exported`. The host prefixes it with `dataapp.`, so
 * do not repeat that here.
 *
 * `properties` describe the event: which control, which dimension, which
 * panel. `values` are what the viewer was actually looking at, and travel only
 * when the app declared `telemetry.values` in its spec. When in doubt about
 * which bag something belongs in, it belongs in `values`.
 *
 * Silent outside a frame (tests, a local harness, the composer's preview)
 * rather than throwing: a reporting call is not a reason for a render to fail.
 */
export function report(
  name: string,
  properties?: Readonly<Record<string, TelemetryValue>>,
  values?: Readonly<Record<string, TelemetryValue>>,
): void {
  if (typeof window === 'undefined' || window.parent === window) return
  const message: TelemetryMessage = {
    type: HOST_TELEMETRY,
    name,
    ...(properties === undefined ? {} : { properties }),
    ...(values === undefined ? {} : { values }),
  }
  try {
    window.parent.postMessage(message, '*')
  } catch {
    // structuredClone rejects a non-serialisable property. Dropping the event
    // is correct: the alternative is an app that crashes on its own analytics.
  }
}

/**
 * `report`, bound to one panel.
 *
 * Every event a recipe raises should say which panel it came from, and passing
 * the id by hand at each call site is how that stops happening. Recipes get the
 * panel id from `usePanelMeta()`.
 */
export function panelReporter(panelId: string, recipe: string) {
  return (
    name: string,
    properties?: Readonly<Record<string, TelemetryValue>>,
    values?: Readonly<Record<string, TelemetryValue>>,
  ): void => report(name, { panelId, recipe, ...(properties ?? {}) }, values)
}
