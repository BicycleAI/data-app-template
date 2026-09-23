/**
 * What a viewer changed, as query parameters — so a link carries it.
 *
 * The app runs in a sandboxed iframe with an opaque origin: it cannot read or
 * write the address bar, and `window.top.location` throws. So the two halves
 * are split. This module turns control state into a flat `Record<string,
 * string>` and back; the host page puts that in its own query string and hands
 * it back on load.
 *
 * The wire format is flat and already URL-shaped on purpose. The host does
 * `new URLSearchParams(map)` and is finished — it never learns what a filter
 * is, and the two repositories share no code.
 *
 *     ?f_region=emea,amer&t=30d
 *     ?f_channel=web&from=2026-08-01&to=2026-08-31
 *
 * Only what differs from the app's own defaults is written. An untouched app
 * produces an empty map, so the link a viewer copies before touching anything
 * is the plain app URL, and "no parameters" and "everything at its default"
 * are the same app rather than two.
 */

import { initialFilters, initialTime, presetRange, seedOf, type FiltersState, type TimeState, timePresets } from '../controls.js'
import { filterControls, type Spec, type TimePreset } from '../spec.js'

/** `f_` keeps filter dims in their own namespace, so a dim called `to` cannot collide with the date. */
const FILTER_PREFIX = 'f_'
const PRESET_KEY = 't'
const FROM_KEY = 'from'
const TO_KEY = 'to'

/** A value list is one parameter; a comma is the separator, so a value containing one is escaped. */
const SEPARATOR = ','
const ESCAPED = '%2C'

function join(values: readonly string[]): string {
  return values.map((value) => value.split(SEPARATOR).join(ESCAPED)).join(SEPARATOR)
}

function split(value: string): string[] {
  return value
    .split(SEPARATOR)
    .map((part) => part.split(ESCAPED).join(SEPARATOR))
    .filter((part) => part.length > 0)
}

/** Element-wise, not joined: a filter value may contain the separator, and "New York" is not "New","York". */
function sameValues(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

/**
 * The state a link has to carry, and nothing it does not.
 *
 * `now` is a parameter because the default time range is resolved against it —
 * with `to: "tomorrow"` in the spec, "unchanged" is a moving target, and a test
 * that could not pin it would be testing the clock.
 */
export function encodeViewState(spec: Spec, state: { filters: FiltersState; time: TimeState }, now: Date = new Date()): Record<string, string> {
  const out: Record<string, string> = {}
  const defaults = initialFilters(spec)
  for (const control of filterControls(spec)) {
    const selected = state.filters[control.dim]
    if (selected === undefined) continue
    if (sameValues(selected, defaults[control.dim] ?? seedOf(control))) continue
    out[`${FILTER_PREFIX}${control.dim}`] = join(selected)
  }

  const baseline = initialTime(spec, now)
  if (state.time.preset !== undefined) {
    if (state.time.preset !== baseline.preset) out[PRESET_KEY] = state.time.preset
  } else if (state.time.from !== baseline.from || state.time.to !== baseline.to) {
    out[FROM_KEY] = state.time.from
    out[TO_KEY] = state.time.to
  }
  return out
}

/**
 * A link's parameters, read back as control state.
 *
 * Everything here arrives from a URL a stranger may have edited, so nothing is
 * trusted: an unknown dim, a value the filter does not offer, a preset the app
 * does not use and a half-given date range are all dropped rather than
 * applied. A bad link opens the app at its defaults; it never opens an app
 * narrowed to something that is not on offer.
 */
export function decodeViewState(spec: Spec, params: Readonly<Record<string, string>>, now: Date = new Date()): { filters?: FiltersState; time?: TimeState } {
  const filters: Record<string, readonly string[]> = {}
  for (const control of filterControls(spec)) {
    const raw = params[`${FILTER_PREFIX}${control.dim}`]
    if (raw === undefined) continue
    const offered = new Set((control.options ?? seedOf(control)).map((value: unknown) => String(value)))
    const picked = split(raw).filter((value) => offered.has(value))
    if (picked.length === 0) continue
    // A single-select filter takes one value however many the link carried.
    filters[control.dim] = control.multi === true ? picked : [picked[0] as string]
  }

  const preset = params[PRESET_KEY]
  const from = params[FROM_KEY]
  const to = params[TO_KEY]
  let time: TimeState | undefined
  if (preset !== undefined && (timePresets(spec) as readonly string[]).includes(preset)) {
    time = { ...presetRange(preset as TimePreset, spec, now), preset: preset as TimePreset }
  } else if (isDate(from) && isDate(to) && from <= to) {
    time = { from, to }
  }

  return {
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(time === undefined ? {} : { time }),
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
function isDate(value: string | undefined): value is string {
  return value !== undefined && DATE.test(value)
}

/** The message the frame posts when a viewer changes something the link should carry. */
export const HOST_VIEW_STATE = 'studio:sandbox:view-state'

/**
 * The link's parameters as the host handed them over.
 *
 * They ride in the frame's own fragment, beside the view token, because that is the
 * channel the host already owns and already rewrites without reloading the frame.
 * Reading it costs nothing and returns an empty map when there is none.
 */
export function readLinkParams(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const hash = window.location.hash.replace(/^#/, '')
    if (hash.length === 0) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(hash)) {
      // `vt`, `exp`, `app` and `v` are the host's own fragment keys, not view state.
      if (key === 'vt' || key === 'exp' || key === 'app' || key === 'v') continue
      out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Tell the host what the link should now say.
 *
 * Fire-and-forget: the host may not be listening (the playground does not own a
 * shareable URL), and a viewer changing a filter must not fail because of it.
 */
export function reportViewState(params: Readonly<Record<string, string>>): void {
  if (typeof window === 'undefined' || window.parent === window) return
  try {
    window.parent.postMessage({ type: HOST_VIEW_STATE, params }, '*')
  } catch {
    // An unreachable host is not the viewer's problem; the app keeps working unshared.
  }
}
