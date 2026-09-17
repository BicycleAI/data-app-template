/**
 * T3.5, "Provenance — How is this computed?"
 *
 * A quiet affordance on every widget card that, on click, opens a small
 * anchored popover (never a modal) showing exactly where that panel's data
 * came from: the semantic SQL with the currently applied parameters
 * substituted in for display, the measures shown with their semantic-layer
 * definitions, the recipe's `explain` sentence (the "Method"), and the row
 * count + as-of.
 *
 * Everything this needs travels WITH the composed app already —
 * `window.__DATA_APP_QUERIES` (see `spec.ts`'s `loadQueries`) and the
 * panel's own `explain` (via `usePanelMeta()`) — so this component never
 * fetches anything; it only reads what compose-time already baked in.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildFilterParams, useControls, type TimeState } from '../controls.js'
import { loadQueries, measureById, type QueryParam, type QuerySpec, type Spec, word } from '../spec.js'
import { usePanelMeta } from '../studio/contextRegistry.js'
import type { Scalar } from '../studio/types.js'

/** What one panel's provenance popover should show — the recipe supplies this; everything else (SQL, definitions, explain) is looked up from it. */
export type ProvenanceSpec = {
  /** QUERY ids (`spec.ts`'s `QUERY` map) this panel's visible data came from. */
  readonly queries: readonly string[]
  /** Measure ids (`spec.measures[].id`) shown on this panel. */
  readonly measures: readonly string[]
  /** Rows backing what's shown, when the recipe can say so cheaply. */
  readonly rowCount?: number
  /** The data's as-of: last period in `by_time`, or the ab_test family's `context.as_of` / meta window end. */
  readonly asOf?: string
}

/**
 * Builds a `ProvenanceSpec`, omitting `rowCount`/`asOf` when they come out
 * undefined (a recipe often computes them as `x || undefined`) rather than
 * ever writing an explicit `rowCount: undefined` — this repo's
 * `exactOptionalPropertyTypes` forbids that even for an optional field. Every
 * Render.tsx builds its `provenance` prop through this rather than a raw
 * object literal.
 */
export function provenanceSpec(input: { readonly queries: readonly string[]; readonly measures: readonly string[]; readonly rowCount?: number | undefined; readonly asOf?: string | undefined }): ProvenanceSpec {
  const { queries, measures, rowCount, asOf } = input
  return { queries, measures, ...(rowCount === undefined ? {} : { rowCount }), ...(asOf === undefined ? {} : { asOf }) }
}

/** The value a `:name` token in a query's SQL currently resolves to, for display only — never mutates the query. */
function resolvedValue(name: string, param: QueryParam | undefined, spec: Spec, time: TimeState, filterParams: Readonly<Record<string, Scalar>>): string | undefined {
  if (name === 'from') return time.from
  if (name === 'to') return time.to
  if (name === 'entity') return spec.entity === undefined ? undefined : '<entity>'
  if (name in filterParams) return String(filterParams[name])
  return param?.default === undefined ? undefined : String(param.default)
}

/**
 * The query's SQL with every `:name` token replaced by its current value —
 * `:from`/`:to` as bare date literals, `:entity` as an unresolved `<entity>`
 * token, everything else (a filter slot) quoted as a SQL string literal. A
 * token this can't resolve is left as-is.
 */
function substituteSql(query: QuerySpec, spec: Spec, time: TimeState, filterParams: Readonly<Record<string, Scalar>>): string {
  const byName = new Map(query.parameters.map((param) => [param.name, param]))
  return query.sql.replace(/:([a-zA-Z_]\w*)/g, (token, name: string) => {
    const value = resolvedValue(name, byName.get(name), spec, time, filterParams)
    if (value === undefined) return token
    if (name === 'from' || name === 'to' || name === 'entity') return value
    return `'${value}'`
  })
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // Clipboard access isn't guaranteed in every embedding — fail quietly, never throw.
  }
}

function QueryBlock({ query, spec, time, filterParams }: { query: QuerySpec; spec: Spec; time: TimeState; filterParams: Readonly<Record<string, Scalar>> }) {
  const substituted = substituteSql(query, spec, time, filterParams)
  return (
    <div className="kit-provenance__query">
      <div className="kit-provenance__query-id">{query.id}</div>
      <pre className="kit-provenance__sql">{substituted}</pre>
      {query.parameters.length > 0 ? (
        <table className="kit-provenance__ptable">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {query.parameters.map((param) => (
              <tr key={param.name}>
                <td>{param.name}</td>
                <td>{param.type}</td>
                <td>{resolvedValue(param.name, param, spec, time, filterParams) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <button type="button" className="kit-provenance__copy" onClick={() => void copyToClipboard(substituted)}>
        Copy SQL
      </button>
    </div>
  )
}

function PopoverContent({ spec, provenance }: { spec: Spec; provenance: ProvenanceSpec }) {
  const meta = usePanelMeta()
  const { time, filters } = useControls()
  const { params: filterParams } = buildFilterParams(spec, filters)
  const allQueries = loadQueries()
  const queries = provenance.queries.map((id) => allQueries.find((query) => query.id === id)).filter((query): query is QuerySpec => query !== undefined)

  return (
    <div className="kit-provenance__popover" role="dialog" aria-label="How is this computed?">
      {queries.length > 0 ? (
        <section className="kit-provenance__section">
          <div className="kit-provenance__heading">Query</div>
          {queries.map((query) => (
            <QueryBlock key={query.id} query={query} spec={spec} time={time} filterParams={filterParams} />
          ))}
        </section>
      ) : null}
      {provenance.measures.length > 0 ? (
        <section className="kit-provenance__section">
          <div className="kit-provenance__heading">Measures</div>
          <ul className="kit-provenance__measures">
            {provenance.measures.map((id) => {
              const measure = measureById(spec, id)
              return (
                <li key={id}>
                  <b>{word(spec, id)}</b> <span className="bda-subtle">({measure?.column ?? id})</span>
                  <div>{measure?.definition ?? 'no definition recorded'}</div>
                  {measure?.expression === undefined ? null : <div className="kit-provenance__expr">{measure.expression}</div>}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {meta?.explain === undefined ? null : (
        <section className="kit-provenance__section">
          <div className="kit-provenance__heading">Method</div>
          <p className="kit-provenance__method">{meta.explain}</p>
        </section>
      )}
      <section className="kit-provenance__section">
        <div className="kit-provenance__heading">Data</div>
        <div className="kit-provenance__data">
          {provenance.rowCount ?? '—'} rows · as of {provenance.asOf ?? '—'}
        </div>
      </section>
    </div>
  )
}

/**
 * Imperative escape hatch, keyed by panel id — for code outside a card's own
 * click handler that wants to jump straight to its provenance popover. The
 * `summary` recipe's `[n]` reference buttons are the one caller today (T5.4):
 * a figure names the panel it came from, and clicking it should open that
 * panel's "How is this computed?" card, not just describe it in prose.
 *
 * A plain module-level `Map` rather than a context or a message, matching
 * `contextRegistry.ts`'s `onHighlight` registry right next to it — both are
 * "point at a panel already on the page" primitives, just imperative instead
 * of event-based, since there is exactly one popover per panel to open.
 */
const openers = new Map<string, () => void>()

/**
 * Opens a mounted panel's provenance popover. Returns `false` (a no-op)
 * when that panel has no provenance affordance mounted right now — off
 * screen, or a card with nothing worth explaining (`Widget` was never given
 * a `provenance` prop) — so a caller can fall back to just pulsing the card
 * via `contextRegistry.ts`'s highlight mechanism instead.
 */
export function openProvenance(panelId: string): boolean {
  const open = openers.get(panelId)
  if (open === undefined) return false
  open()
  return true
}

function sideFor(anchor: DOMRect | undefined): 'left' | 'right' {
  // The popover hangs from the card's top-right "?" and normally opens leftwards. On a narrow card
  // near the left edge of the viewport that would push it off-screen, so it opens rightwards instead.
  if (anchor === undefined) return 'left'
  return anchor.right - 420 < 8 && anchor.left + 420 < window.innerWidth - 8 ? 'right' : 'left'
}

/** The "How is this computed?" affordance + its popover. Rendered by `Widget` (parts.tsx) inside a `position: relative` card. */
export function Provenance({ spec, provenance, panelId }: { spec: Spec; provenance: ProvenanceSpec; panelId?: string | undefined }) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'left' | 'right'>('left')
  const containerRef = useRef<HTMLDivElement>(null)

  const toggle = () => {
    setSide(sideFor(containerRef.current?.getBoundingClientRect()))
    setOpen((current) => !current)
  }

  const openImperatively = useCallback(() => {
    setSide(sideFor(containerRef.current?.getBoundingClientRect()))
    setOpen(true)
  }, [])

  useEffect(() => {
    if (panelId === undefined) return
    openers.set(panelId, openImperatively)
    return () => {
      if (openers.get(panelId) === openImperatively) openers.delete(panelId)
    }
  }, [panelId, openImperatively])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="kit-provenance" ref={containerRef}>
      <button type="button" className="kit-provenance__trigger" aria-label="How is this computed?" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <div className={side === 'right' ? 'kit-provenance__side kit-provenance__side--right' : 'kit-provenance__side'}>
          <PopoverContent spec={spec} provenance={provenance} />
        </div>
      ) : null}
    </div>
  )
}
