/**
 * The frame's context reporter.
 *
 * This is the same protocol the composed runtime implements in
 * `runtime/src/studio/contextRegistry.ts`, kept framework-light here because
 * a hand-built app has no composer-resolved panel list to hang a React
 * context off of. See README-FOR-AGENTS.md's "Report your panels" — wrap
 * every card your app renders with `registerPanel`/`unregisterPanel` so it
 * gets the same host-owned chat a composed app does, for free. Then call
 * `setPageScope` with what the whole page is set to (its window, filters and
 * measure), which the host sends with every chat question.
 *
 * Not `studio/context.ts` on purpose: that file is already the app's identity
 * (`initContext`/`context`) — the token, the app id, the theme. This is a
 * separate, unrelated concern with its own module.
 *
 * Invariant 9 (AGENTS.md): the host page owns chat, one implementation,
 * living there. This module never renders anything — it only reports what is
 * on screen, and listens for the one message the host may send back
 * (`studio:sandbox:highlight`) to point at a panel already on the page. Do
 * not build a chat, an ask box or a drawer here or anywhere in this app;
 * that is exactly what this module exists to make unnecessary.
 */

export type PanelMeta = {
  /** Yours to choose; keep it stable across renders (a query id or a fixed string both work) so the host can tell "the same card, new data" from "a different card". */
  readonly panelId: string
  /** A short name for what kind of card this is — there is no recipe catalogue here, so any short id works, e.g. `'revenue_by_month'` or `'custom'`. */
  readonly recipe: string
  readonly say?: string
  /** The declared query this card draws, from `bda.manifest.json` — what the host's chat can re-run for the real numbers. */
  readonly queryId?: string
  readonly bind?: Readonly<Record<string, unknown>>
  /** Whatever is cheap and worth summarising — top rows, last points, current values. ≤ 2 KB; larger values are trimmed, never thrown. */
  readonly digest?: unknown
}

export type PanelRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scrollX: number
  readonly scrollY: number
}

export type PanelReport = {
  readonly panelId: string
  readonly recipe: string
  readonly say?: string
  readonly queryId?: string
  readonly bind: Readonly<Record<string, unknown>>
  readonly selection?: unknown
  readonly digest?: unknown
  readonly rect: PanelRect
}

/**
 * What the whole page is set to, fully resolved. The host sends it with every
 * chat question and the agent applies it to every query it runs, so report
 * it whole, defaults included (`complete: true`). The same shape a composed
 * app reports (`runtime/src/studio/scope.ts` in the kit). See
 * README-FOR-AGENTS.md's "Report what the page is set to".
 */
export type PageScope = {
  readonly complete: true
  /** The model your queries read (`FROM m_…`). */
  readonly model?: string
  readonly window?: {
    /** The time column your queries bound. */
    readonly column?: string
    /** Inclusive, `YYYY-MM-DD`. */
    readonly from: string
    /** EXCLUSIVE, `YYYY-MM-DD`: the `time >= :from AND time < :to` your queries use. */
    readonly to: string
    /** The preset picked, if any (`7d`, `30d`, `90d`, `quarter`, `ytd`). */
    readonly preset?: string
    readonly grain?: string
    /** Whether this is the window the page opens on. */
    readonly isDefault: boolean
  }
  readonly asOf?: string
  /** Only the filters that narrow: one at "All" is left out. `[]` when none does. */
  readonly filters: readonly { readonly field: string; readonly label?: string; readonly values: readonly string[]; readonly isDefault: boolean }[]
  readonly measure?: { readonly id: string; readonly column?: string; readonly label?: string }
  /** The split-by dimensions on screen. */
  readonly dimensions?: readonly { readonly field: string; readonly label?: string }[]
  readonly entity?: { readonly field: string; readonly value: string; readonly label?: string }
  /** "Last `periods` vs the `periods` before", when a card compares periods. */
  readonly compare?: { readonly periods: number; readonly grain?: string }
  /** The tab on screen, when the app has tabs. */
  readonly tab?: string
}

export type ContextMessage = {
  readonly type: 'studio:sandbox:context'
  readonly panels: readonly PanelReport[]
  readonly tokens: Readonly<Record<string, string>>
  /** On every message once `setPageScope` has been called. */
  readonly scope?: PageScope
}

export type HighlightMessage = {
  readonly type: 'studio:sandbox:highlight'
  readonly panelId: string
}

/** The `--bda-*` custom properties declared on `:root` in `theme.css`. Add a name here if you add a token there. */
export const THEME_TOKENS: readonly string[] = [
  '--bda-surface-background',
  '--bda-surface-raised',
  '--bda-surface-overlay',
  '--bda-text-primary',
  '--bda-text-secondary',
  '--bda-border',
  '--bda-grid',
  '--bda-accent',
  '--bda-accent-soft',
  '--bda-accent-muted',
  '--bda-positive',
  '--bda-negative',
  '--bda-chart-1',
  '--bda-chart-2',
  '--bda-chart-3',
  '--bda-chart-4',
  '--bda-chart-5',
  '--bda-chart-6',
  '--bda-font-family',
  '--bda-font-size',
  '--bda-radius',
  '--bda-radius-pill',
  '--bda-space-1',
  '--bda-space-2',
  '--bda-space-3',
  '--bda-space-4',
  '--bda-space-5',
  '--bda-shadow',
]

function readTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(name).trim()
    if (value.length > 0) tokens[name] = value
  }
  return tokens
}

const DIGEST_BUDGET_BYTES = 2048

function withinBudget(value: unknown): unknown {
  if (value === undefined) return undefined
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    return undefined
  }
  if (json.length <= DIGEST_BUDGET_BYTES) return value
  if (!Array.isArray(value)) return undefined
  const copy = [...value]
  while (copy.length > 0 && JSON.stringify(copy).length > DIGEST_BUDGET_BYTES) copy.pop()
  return copy.length > 0 ? copy : undefined
}

/** What the host accepts. `setPageScope` trims to these rather than throwing, like the digest budget above. */
const SCOPE_LIMITS = { filters: 24, values: 100, dimensions: 24, chars: 256 }

const clip = (text: string): string => text.slice(0, SCOPE_LIMITS.chars)

/** Every string field of a flat object clipped to the limit. */
function clipped<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? clip(item) : item])) as T
}

/** A real calendar day, `YYYY-MM-DD`: `2026-02-31` does not survive the round trip. */
function isDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function withinLimits(scope: PageScope): PageScope {
  const { window: range, asOf, filters, dimensions, measure, entity, model, tab, ...rest } = scope
  return {
    ...rest,
    ...(model === undefined ? {} : { model: clip(model) }),
    ...(range === undefined || !isDay(range.from) || !isDay(range.to) ? {} : { window: clipped(range) }),
    ...(asOf === undefined || !isDay(asOf) ? {} : { asOf }),
    filters: filters.slice(0, SCOPE_LIMITS.filters).map((filter) => ({ ...clipped(filter), values: filter.values.slice(0, SCOPE_LIMITS.values).map(clip) })),
    ...(measure === undefined ? {} : { measure: clipped(measure) }),
    ...(dimensions === undefined ? {} : { dimensions: dimensions.slice(0, SCOPE_LIMITS.dimensions).map((dimension) => clipped(dimension)) }),
    ...(entity === undefined ? {} : { entity: clipped(entity) }),
    ...(tab === undefined ? {} : { tab: clip(tab) }),
  }
}

type Panel = { meta: PanelMeta; el: Element; selection: unknown }

const panels = new Map<string, Panel>()
const highlightListeners = new Map<string, Set<() => void>>()
const resizeObservers = new Map<string, ResizeObserver>()

let reportTimer: ReturnType<typeof setTimeout> | undefined
let rafScheduled = false
let listening = false
let scope: PageScope | undefined
let scopeKey: string | undefined
/** A context message has gone out, so the first report is no longer pending. */
let posted = false

function rectOf(el: Element): PanelRect {
  const box = el.getBoundingClientRect()
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    scrollX: typeof window === 'undefined' ? 0 : window.scrollX,
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
  }
}

function buildReport(): readonly PanelReport[] {
  const out: PanelReport[] = []
  for (const [panelId, panel] of panels) {
    const digest = withinBudget(panel.meta.digest)
    out.push({
      panelId,
      recipe: panel.meta.recipe,
      ...(panel.meta.say === undefined ? {} : { say: panel.meta.say }),
      ...(panel.meta.queryId === undefined ? {} : { queryId: panel.meta.queryId }),
      bind: panel.meta.bind ?? {},
      ...(panel.selection === undefined ? {} : { selection: panel.selection }),
      ...(digest === undefined ? {} : { digest }),
      rect: rectOf(panel.el),
    })
  }
  return out
}

function post(): void {
  if (typeof window === 'undefined' || window.parent === window) return
  const message: ContextMessage = { type: 'studio:sandbox:context', panels: buildReport(), tokens: readTokens(), ...(scope === undefined ? {} : { scope }) }
  window.parent.postMessage(message, '*')
  posted = true
}

/** Registry change: debounced 100ms. */
function scheduleReport(): void {
  if (typeof window === 'undefined') return
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    reportTimer = undefined
    post()
  }, 100)
}

/** Scroll/resize, and a scope change: rAF-throttled — no need to wait 100ms. */
function scheduleGeometryReport(): void {
  if (rafScheduled || typeof window === 'undefined') return
  rafScheduled = true
  window.requestAnimationFrame(() => {
    rafScheduled = false
    post()
  })
}

function onIncomingMessage(event: MessageEvent<Partial<HighlightMessage> | undefined>): void {
  const data = event.data
  if (data === null || typeof data !== 'object' || data.type !== 'studio:sandbox:highlight') return
  const panelId = (data as HighlightMessage).panelId
  if (typeof panelId !== 'string') return
  for (const listener of highlightListeners.get(panelId) ?? []) listener()
}

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('scroll', scheduleGeometryReport, { passive: true, capture: true })
  window.addEventListener('resize', scheduleGeometryReport)
  window.addEventListener('message', onIncomingMessage)
  // Once after first paint: two rAFs so the browser has actually painted the
  // frame that just registered, not merely scheduled it.
  window.requestAnimationFrame(() => window.requestAnimationFrame(post))
}

/**
 * Register (or update) one rendered card. Call it again with the same
 * `meta.panelId` whenever `meta` changes — a new `digest` when the data
 * refreshes, a different `say` — there is no separate "update" call.
 */
export function registerPanel(el: Element, meta: PanelMeta): void {
  ensureListening()
  const { panelId } = meta
  const existing = panels.get(panelId)
  panels.set(panelId, { meta, el, selection: existing?.selection })
  if (!resizeObservers.has(panelId)) {
    const observer = new ResizeObserver(() => scheduleGeometryReport())
    observer.observe(el)
    resizeObservers.set(panelId, observer)
  }
  scheduleReport()
}

/** Call from your card's cleanup (an effect's return, or on unmount) — an unregistered panel is not reported. */
export function unregisterPanel(panelId: string): void {
  resizeObservers.get(panelId)?.disconnect()
  resizeObservers.delete(panelId)
  panels.delete(panelId)
  scheduleReport()
}

/**
 * Report what the page is set to (`PageScope`), whole, on mount and again
 * whenever any of it changes: the window, a filter, the measure. It rides on
 * every context message from then on. The same scope twice is a no-op; a
 * real change goes out on the next frame, so a question typed right after a
 * filter change already carries it. Nothing is posted for it before your
 * first `registerPanel`, whose first report carries it.
 */
export function setPageScope(next: PageScope): void {
  const capped = withinLimits(next)
  const key = JSON.stringify(capped)
  if (key === scopeKey) return
  scope = capped
  scopeKey = key
  if (posted) scheduleGeometryReport()
}

/** The picked row/point/cell, if your card has one worth reporting. Most cards do not need this. */
export function setSelection(panelId: string, selection: unknown): void {
  const panel = panels.get(panelId)
  if (panel === undefined) return
  panel.selection = selection
  scheduleReport()
}

/**
 * Subscribe to `studio:sandbox:highlight` for one panel id, e.g. to add a
 * highlight class and scroll the card into view:
 *
 *   useEffect(() => onHighlight(panelId, () => {
 *     el.scrollIntoView({ block: 'center' })
 *     el.classList.add('kit-card--highlight')
 *     setTimeout(() => el.classList.remove('kit-card--highlight'), 1600)
 *   }), [panelId])
 *
 * Returns an unsubscribe.
 */
export function onHighlight(panelId: string, listener: () => void): () => void {
  let set = highlightListeners.get(panelId)
  if (set === undefined) {
    set = new Set()
    highlightListeners.set(panelId, set)
  }
  const current = set
  current.add(listener)
  return () => {
    current.delete(listener)
    if (current.size === 0) highlightListeners.delete(panelId)
  }
}
