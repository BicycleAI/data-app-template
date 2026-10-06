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
 * measure), which the host sends with every chat question. And describe the
 * page itself, its controls and what each one offers, with `registerControl`
 * (or `components/useReportControl.ts`) and `setPageInfo`, which the host
 * sends when a chat thread starts and again when it changes.
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

/** One choice a control offers. `label` when the page shows something other than the value. */
export type OutlineOption = { readonly value: string; readonly label?: string }

/** One control that changes what the page shows. See README-FOR-AGENTS.md's "Describe the page". */
export type OutlineControl = {
  /** Stable and unique on the page: `'time'`, `'filter.channel'`. Registering the same id again updates that control in place. */
  readonly id: string
  /** `'dateRange'`, `'filter'`, `'measure'`, `'dimensions'`, `'entity'`, `'select'` or `'toggle'`. */
  readonly kind: string
  /** As the page shows it: `'Time'`, `'Channel'`. */
  readonly label: string
  /** In the page's order. A `dateRange`'s options are its presets. Leave it out until they load. */
  readonly options?: readonly OutlineOption[]
  /** How many options there are in all, when `options` lists fewer (or none). */
  readonly optionCount?: number
  /** `true` when more than one option may be picked; leave it out otherwise. */
  readonly multi?: boolean
  /** With `multi`: at most this many. */
  readonly maxPicks?: number
  /** The option values the page starts on. `[]` is nothing picked, which narrows nothing. */
  readonly default?: readonly string[]
  /** `YYYY-MM-DD`, inclusive: a `dateRange` that also takes any custom from/to between these. */
  readonly range?: { readonly min: string; readonly max: string }
  /** The `<Panel id>` of the one card this control sits in and changes. Leave it out for a control that changes the whole page. */
  readonly panelId?: string
}

/** A card the page has, on screen or not: `panelId` is its `<Panel id>`. */
export type OutlinePanel = { readonly panelId: string; readonly title: string; readonly kind?: string; readonly explain?: string; readonly tab?: string }

export type OutlineTab = { readonly label: string; readonly active: boolean }

/**
 * What the page is, for the host's chat: its controls and what each one
 * offers, its panels, its tabs. Structure only: what each control is set to
 * now is the scope's. The same shape a composed app reports
 * (`runtime/src/studio/outline.ts` in the kit). You never build it whole:
 * the registry assembles it from `registerControl` and `setPageInfo`.
 */
export type PageOutline = {
  readonly title?: string
  /** What the page is for, in a sentence. */
  readonly description?: string
  /** In screen order: the order they first registered. */
  readonly controls: readonly OutlineControl[]
  /** Every card the page has, on screen or not. */
  readonly panels?: readonly OutlinePanel[]
  readonly tabs?: readonly OutlineTab[]
  /** Text a viewer reads that no control or panel carries: what the data covers, a caveat, a definition. */
  readonly notes?: readonly string[]
}

/** `setPageInfo`'s argument: the outline, less the controls, which register themselves. */
export type PageInfo = Omit<PageOutline, 'controls'>

export type ContextMessage = {
  readonly type: 'studio:sandbox:context'
  readonly panels: readonly PanelReport[]
  readonly tokens: Readonly<Record<string, string>>
  /** On every message once `setPageScope` has been called. */
  readonly scope?: PageScope
  /** On every message once a control or the page info has been reported. */
  readonly outline?: PageOutline
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

/**
 * What the host accepts for the outline. `registerControl` and `setPageInfo`
 * trim to these rather than throwing. `chars` is short text (an id, label,
 * value, title or tab), `longChars` a description, an explain or a note.
 */
const OUTLINE_LIMITS = {
  controls: 24,
  options: 100,
  defaults: 100,
  panels: 48,
  tabs: 12,
  notes: 8,
  chars: 256,
  kindChars: 64,
  panelIdChars: 128,
  longChars: 1000,
  optionCount: 1_000_000,
  maxPicks: 1000,
}

/** `String()` first: an option read off query rows need not be a string, and this must not throw. */
const cut = (text: string, max: number): string => String(text).slice(0, max)

/** A whole number within `[min, max]`, or undefined for one that is not a number at all. */
function within(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function optionWithinLimits(option: OutlineOption): OutlineOption {
  return { value: cut(option.value, OUTLINE_LIMITS.chars), ...(option.label === undefined ? {} : { label: cut(option.label, OUTLINE_LIMITS.chars) }) }
}

/**
 * One control, trimmed. A list longer than 100 keeps its first 100, and
 * `optionCount` says how many there were. `maxPicks` goes only with `multi`,
 * and a `range` that is not two real days, `min` first, is left out.
 */
function controlWithinLimits(control: OutlineControl): OutlineControl {
  const { id, kind, label, options, optionCount, multi, maxPicks, default: initial, range, panelId } = control
  const cutList = options !== undefined && options.length > OUTLINE_LIMITS.options
  const count = within(cutList ? Math.max(optionCount ?? 0, options.length) : optionCount, 0, OUTLINE_LIMITS.optionCount)
  const picks = multi === true ? within(maxPicks, 1, OUTLINE_LIMITS.maxPicks) : undefined
  return {
    id: cut(id, OUTLINE_LIMITS.chars),
    kind: cut(kind, OUTLINE_LIMITS.kindChars),
    label: cut(label, OUTLINE_LIMITS.chars),
    ...(options === undefined ? {} : { options: options.slice(0, OUTLINE_LIMITS.options).map(optionWithinLimits) }),
    ...(count === undefined ? {} : { optionCount: count }),
    ...(multi === true ? { multi: true } : {}),
    ...(picks === undefined ? {} : { maxPicks: picks }),
    ...(initial === undefined ? {} : { default: initial.slice(0, OUTLINE_LIMITS.defaults).map((value) => cut(value, OUTLINE_LIMITS.chars)) }),
    ...(range === undefined || !isDay(range.min) || !isDay(range.max) || range.min > range.max ? {} : { range: { min: range.min, max: range.max } }),
    ...(panelId === undefined ? {} : { panelId: cut(panelId, OUTLINE_LIMITS.panelIdChars) }),
  }
}

function infoWithinLimits(info: PageInfo): PageInfo {
  const { title, description, panels, tabs, notes } = info
  return {
    ...(title === undefined ? {} : { title: cut(title, OUTLINE_LIMITS.chars) }),
    ...(description === undefined ? {} : { description: cut(description, OUTLINE_LIMITS.longChars) }),
    ...(panels === undefined
      ? {}
      : {
          panels: panels.slice(0, OUTLINE_LIMITS.panels).map((panel) => ({
            panelId: cut(panel.panelId, OUTLINE_LIMITS.panelIdChars),
            title: cut(panel.title, OUTLINE_LIMITS.chars),
            ...(panel.kind === undefined ? {} : { kind: cut(panel.kind, OUTLINE_LIMITS.kindChars) }),
            ...(panel.explain === undefined ? {} : { explain: cut(panel.explain, OUTLINE_LIMITS.longChars) }),
            ...(panel.tab === undefined ? {} : { tab: cut(panel.tab, OUTLINE_LIMITS.chars) }),
          })),
        }),
    ...(tabs === undefined ? {} : { tabs: tabs.slice(0, OUTLINE_LIMITS.tabs).map((tab) => ({ label: cut(tab.label, OUTLINE_LIMITS.chars), active: tab.active === true })) }),
    ...(notes === undefined ? {} : { notes: notes.slice(0, OUTLINE_LIMITS.notes).map((note) => cut(note, OUTLINE_LIMITS.longChars)) }),
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
/** Registered controls, by id. A `Map` keeps insertion order, and `set` on an id it has keeps its place. */
const controls = new Map<string, OutlineControl>()
let pageInfo: PageInfo | undefined
let outline: PageOutline | undefined
let outlineKey: string | undefined
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
  const message: ContextMessage = {
    type: 'studio:sandbox:context',
    panels: buildReport(),
    tokens: readTokens(),
    ...(scope === undefined ? {} : { scope }),
    ...(outline === undefined ? {} : { outline }),
  }
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

/** Scroll/resize, and a scope or outline change: rAF-throttled — no need to wait 100ms. */
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

/** The outline as the registry holds it now: the page info plus every registered control. Posted on the next frame when it changed. */
function updateOutline(): void {
  const next: PageOutline = { ...pageInfo, controls: [...controls.values()].slice(0, OUTLINE_LIMITS.controls) }
  const key = JSON.stringify(next)
  if (key === outlineKey) return
  outline = next
  outlineKey = key
  if (posted) scheduleGeometryReport()
}

/**
 * Describe one control the page shows (`OutlineControl`): what it is and
 * what it offers, not what it is set to (that is the scope's). Call it on
 * mount and again whenever what it offers changes, e.g. once its options
 * load: registering the same `id` again updates it in place, so controls are
 * reported in the order they first registered, which should be the order
 * they appear on the page. `components/useReportControl.ts` does all of this
 * for you. From then on, every context message carries the outline; the
 * same outline twice is a no-op, and a change goes out on the next frame.
 */
export function registerControl(control: OutlineControl): void {
  controls.set(control.id, controlWithinLimits(control))
  updateOutline()
}

/** Call when the control leaves the page (on unmount). */
export function unregisterControl(id: string): void {
  if (!controls.delete(id)) return
  updateOutline()
}

/**
 * Describe the page itself (`PageInfo`): its `title`, what it is for
 * (`description`), `notes` a viewer reads that no control or panel carries,
 * its `tabs`, and every card it has (`panels`), on screen or not. Whole
 * every time: a field left out is no longer reported. It rides with the
 * controls in the page's outline.
 */
export function setPageInfo(next: PageInfo): void {
  pageInfo = infoWithinLimits(next)
  updateOutline()
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
