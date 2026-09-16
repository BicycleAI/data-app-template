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
 *     replaced rather than appended to.
 *
 * Read the mark documentation at https://observablehq.com/plot — this only
 * handles mounting, never what to draw.
 */

import * as Plot from '@observablehq/plot'
import { useEffect, useMemo, useRef, useState } from 'react'
import { onThemeChange } from '../studio/theme.js'

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
}

export function Chart({ options, height = 260, title, className }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [theme, setTheme] = useState<ThemeTokens>(readThemeTokens)

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
    node.replaceChildren(figure)

    return () => {
      // Plot returns a detached node it does not own; remove it explicitly.
      figure.remove()
    }
  }, [themed, width, title])

  return <div ref={host} className={`bda-chart${className === undefined ? '' : ` ${className}`}`} />
}
