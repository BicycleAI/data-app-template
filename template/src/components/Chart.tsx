/**
 * Observable Plot, wired to the theme.
 *
 * Plot is the only charting library in this template, and the one an app
 * should use. It is a bundled dependency, not a CDN script: the page an app
 * runs in sets `default-src 'none'; script-src 'self'`, so a `<script>` from
 * a CDN would simply not load — and widening that policy to allow one would
 * allow every other package on the same CDN too.
 *
 * What this wrapper adds over calling `Plot.plot()` directly:
 *
 *   - the theme's colours and fonts, so a chart matches the app rather than
 *     defaulting to Plot's black-on-white,
 *   - re-reading them when the theme changes, since Plot is handed resolved
 *     colour values and cannot follow a CSS variable the way a stylesheet can,
 *   - width that follows the container, remeasured on resize, because the
 *     frame can be any size,
 *   - correct teardown, since Plot returns a detached node that has to be
 *     replaced rather than appended to,
 *   - inside a `<Panel>`, the datum under the pointer (any mark with `tip` or
 *     `Plot.pointer`) reported to the host's chat, so a viewer can hover a
 *     bar or point and "Add … to chat" just that one.
 *
 * Read the mark documentation at https://observablehq.com/plot — this only
 * handles mounting, never what to draw.
 */

import * as Plot from '@observablehq/plot'
import { useEffect, useMemo, useRef, useState } from 'react'
import { setSelection } from '../studio/contextRegistry.js'
import { onThemeChange } from '../studio/theme.js'
import { usePanelId } from './Panel.js'

/** Resolve a `--bda-*` variable to its value, for passing into Plot. */
export function token(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

/**
 * The categorical ramp, in draw order. Pass as Plot's `color.range`.
 *
 * Empty when the theme defines no ramp, and deliberately so: a hardcoded hex
 * here would be a colour from whichever palette this file was written against,
 * which is exactly the wrong answer in a rethemed app — and this is not a file
 * an app is expected to edit. When it comes back empty the caller leaves
 * Plot's own default scheme in place instead.
 */
export function chartPalette(): string[] {
  return [1, 2, 3, 4, 5, 6].map((index) => token(`--bda-chart-${index}`)).filter((value) => value.length > 0)
}

type ThemeTokens = {
  readonly palette: readonly string[]
  /** Axis and gridline hairline. Empty means "leave it to Plot". */
  readonly grid: string
  readonly text: string
  readonly fontFamily: string
}

/**
 * Read the theme out of CSS.
 *
 * Every fallback is relative rather than absolute — `currentColor` and
 * `inherit` resolve against the chart's own container, which is themed — so a
 * theme that omits a token still produces a chart in its own colours.
 */
function readThemeTokens(): ThemeTokens {
  return {
    palette: chartPalette(),
    grid: token('--bda-grid', token('--bda-border')),
    text: token('--bda-text-secondary', 'currentColor'),
    fontFamily: token('--bda-font-family', 'inherit'),
  }
}

/** At most this many of a datum's fields go to the chat — a row, not a table. */
const POINT_FIELDS = 12

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/

function shortValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : String(value)
  }
  if (typeof value === 'string') {
    const day = ISO_DAY.exec(value)
    return day === null ? value : (day[1] ?? value)
  }
  return value === null || value === undefined ? '' : String(value)
}

export type ChartPoint = {
  readonly kind: 'point'
  readonly label: string
  readonly datum: Readonly<Record<string, unknown>>
}

/**
 * A hovered datum as the chat's data point: its fields as plain JSON (dates as
 * ISO strings, at most a dozen fields) and a short label — `label(datum)` when
 * given, else its first two fields ("2025-03-01 · 142K").
 */
export function pointSelection(
  datum: object,
  label?: (datum: Record<string, unknown>) => string,
): ChartPoint | undefined {
  let plain: Record<string, unknown>
  try {
    const parsed = JSON.parse(JSON.stringify(datum)) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    plain = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).slice(0, POINT_FIELDS))
  } catch {
    return undefined
  }
  let text = ''
  try {
    text = label === undefined ? '' : label(datum as Record<string, unknown>).trim()
  } catch {
    text = ''
  }
  if (text === '') {
    text = Object.values(plain)
      .slice(0, 2)
      .map(shortValue)
      .filter((part) => part !== '')
      .join(' · ')
  }
  return text === '' ? undefined : { kind: 'point', label: text.slice(0, 120), datum: plain }
}

// `Plot.plot()` takes its options optionally; a chart always has some.
type PlotOptions = NonNullable<Parameters<typeof Plot.plot>[0]>

type Props = {
  /**
   * Plot options, minus `width` — this component supplies that from the
   * container. Build it with `useMemo` so the chart is not rebuilt on every
   * render.
   */
  readonly options: PlotOptions
  readonly height?: number
  /** Accessible description. Charts are images to a screen reader. */
  readonly title?: string
  readonly className?: string
  /**
   * How a hovered datum is named in the chat — `(d) => `${d.state} · ${money(d.revenue)}``.
   * Only used inside a `<Panel>`. Defaults to the datum's first two fields.
   */
  readonly pointLabel?: ((datum: Record<string, unknown>) => string) | undefined
}

export function Chart({ options, height = 260, title, className, pointLabel }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [theme, setTheme] = useState<ThemeTokens>(readThemeTokens)
  const panelId = usePanelId()
  // A ref, so an inline `pointLabel` does not redraw the chart on every render.
  const labelRef = useRef(pointLabel)
  labelRef.current = pointLabel

  // Plot needs a pixel width; the frame's is whatever the host page gave it.
  useEffect(() => {
    const node = host.current
    if (node === null) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // The viewer can switch their system theme with the page open. The
  // stylesheet follows on its own; these values have to be re-read.
  useEffect(() => onThemeChange(() => setTheme(readThemeTokens())), [])

  const themed = useMemo<PlotOptions>(() => {
    const grid = theme.grid.length > 0 ? { stroke: theme.grid } : {}
    return {
      // Defaults first, so anything in `options` wins.
      marginLeft: 52,
      marginBottom: 34,
      style: {
        background: 'transparent',
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontSize: '11px',
      },
      color: {
        ...(theme.palette.length > 0 ? { range: [...theme.palette] } : {}),
        ...(options.color ?? {}),
      },
      x: { ...grid, ...(options.x ?? {}) },
      y: { ...grid, grid: true, ...(options.y ?? {}) },
      ...options,
      width: width > 0 ? width : 640,
      height,
    }
  }, [options, width, height, theme])

  useEffect(() => {
    const node = host.current
    // Nothing to draw until the container has been measured; drawing at the
    // fallback width first would show a chart that immediately resizes.
    if (node === null || width === 0) return

    const figure = Plot.plot(themed)
    if (title !== undefined) {
      figure.setAttribute('role', 'img')
      figure.setAttribute('aria-label', title)
    }

    // Plot sets `value` to the datum under the pointer and fires `input`. The
    // last point is kept when the pointer leaves (value null): the host's
    // "Add … to chat" sits outside the frame, and reaching for it leaves the chart.
    const onInput = () => {
      const datum = (figure as unknown as { value?: unknown }).value
      if (panelId === undefined || datum === null || typeof datum !== 'object') return
      const point = pointSelection(datum, labelRef.current)
      if (point !== undefined) setSelection(panelId, point)
    }
    if (panelId !== undefined) figure.addEventListener('input', onInput)
    node.replaceChildren(figure)

    return () => {
      figure.removeEventListener('input', onInput)
      // Plot returns a detached node it does not own; remove it explicitly.
      figure.remove()
    }
  }, [themed, width, title, panelId])

  // New data: the point that was under the pointer may not exist any more.
  useEffect(() => {
    if (panelId !== undefined) setSelection(panelId, undefined)
  }, [options, panelId])

  return <div ref={host} className={`bda-chart${className === undefined ? '' : ` ${className}`}`} />
}
