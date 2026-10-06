/**
 * T3.5, "Provenance", shown as "Source": every number shows its source.
 *
 * A small "Source" link on every widget card opens a side panel with the
 * panel's plain title, the date window, where the data comes from (model and
 * declared query), the exact semantic SQL with the applied parameters, the
 * row count and first rows of the last result, and a CSV download. The
 * summary recipe's `[n]` citations open the same panel (`openProvenance`), so
 * there is one source component, not two. `spec.showSources: false` turns
 * the link off (default on).
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

import { QueryClientContext } from '@tanstack/react-query'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { buildFilterParams, useControls, type TimeState } from '../controls.js'
import { loadQueries, measureById, type QueryParam, type QuerySpec, type Spec, word } from '../spec.js'
import { usePanelMeta } from '../studio/contextRegistry.js'
import type { QueryResult, Scalar } from '../studio/types.js'

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

/** Rows shown in the panel; the CSV carries every row of the last result. */
export const SOURCE_PREVIEW_ROWS = 5

/**
 * The last result the page loaded for a declared query, read from the query
 * cache the widgets already filled — never a new fetch. Undefined outside a
 * QueryClientProvider (tests, the validation harness) or before it loads.
 */
function useLastResult(queryId: string | undefined): QueryResult | undefined {
  const client = useContext(QueryClientContext)
  if (client === undefined || queryId === undefined) return undefined
  const found = client.getQueryCache().findAll({ predicate: (query) => query.queryKey[0] === 'bda' && query.queryKey[2] === queryId && query.state.data !== undefined })
  found.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  return found[0]?.state.data as QueryResult | undefined
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** A query result as CSV: a header of column names, then every row. */
export function toCsv(result: Pick<QueryResult, 'columns' | 'rows'>): string {
  return [result.columns.map((column) => csvCell(column.name)).join(','), ...result.rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n'
}

function downloadCsv(name: string, csv: string): void {
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch {
    // A frame without allow-downloads (or a test DOM) cannot save a file; the rows are still on screen.
  }
}

function ResultBlock({ queryId }: { queryId: string }) {
  const result = useLastResult(queryId)
  if (result === undefined) return <div className="kit-provenance__data">Rows appear here once the card has loaded.</div>
  const shown = result.rows.slice(0, SOURCE_PREVIEW_ROWS)
  return (
    <div className="kit-provenance__rows">
      <div className="kit-provenance__data">
        {result.meta.rowCount} row{result.meta.rowCount === 1 ? '' : 's'}
        {result.meta.truncated ? ' (truncated)' : ''}
        {shown.length < result.rows.length ? ` · first ${shown.length} shown` : ''}
      </div>
      <div className="kit-scroll">
        <table className="kit-provenance__ptable">
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column.name}>{column.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell === null || cell === undefined ? '—' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="kit-provenance__copy" onClick={() => downloadCsv(queryId, toCsv(result))}>
        Download CSV
      </button>
    </div>
  )
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
      <ResultBlock queryId={query.id} />
    </div>
  )
}

function PopoverContent({ spec, provenance, onClose }: { spec: Spec; provenance: ProvenanceSpec; onClose: () => void }) {
  const meta = usePanelMeta()
  const { time, filters } = useControls()
  const { params: filterParams } = buildFilterParams(spec, filters)
  const allQueries = loadQueries()
  const queries = provenance.queries.map((id) => allQueries.find((query) => query.id === id)).filter((query): query is QuerySpec => query !== undefined)

  return (
    <div className="kit-provenance__popover" role="dialog" aria-label="Source">
      <div className="kit-provenance__head">
        <div className="kit-provenance__title">{meta?.say ?? spec.title}</div>
        <button type="button" className="kit-provenance__close" aria-label="Close source" onClick={onClose}>
          ×
        </button>
      </div>
      <section className="kit-provenance__section">
        <div className="kit-provenance__heading">Where it comes from</div>
        <div className="kit-provenance__data">
          {time.from} to {time.to} (end exclusive) · model <code>{spec.model}</code>
          {queries.length > 0 ? (
            <>
              {' '}
              · quer{queries.length === 1 ? 'y' : 'ies'} {queries.map((query) => query.id).join(', ')}
            </>
          ) : null}
        </div>
      </section>
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
 * panel's "Source" panel, not just describe it in prose.
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

/** Whether this app shows the "Source" link on its cards (`spec.showSources`, default true). */
export function showSources(spec: Spec): boolean {
  return spec.showSources !== false
}

/** The "Source" link + its side panel. Rendered by `Widget` (parts.tsx) inside a `position: relative` card. */
export function Provenance({ spec, provenance, panelId }: { spec: Spec; provenance: ProvenanceSpec; panelId?: string | undefined }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggle = () => setOpen((current) => !current)

  const openImperatively = useCallback(() => setOpen(true), [])

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
      <button type="button" className="kit-provenance__trigger" aria-expanded={open} onClick={toggle}>
        Source
      </button>
      {open ? (
        <div className="kit-provenance__side">
          <PopoverContent spec={spec} provenance={provenance} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
