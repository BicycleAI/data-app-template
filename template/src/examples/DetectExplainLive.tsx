/**
 * Example: Detect & Explain with the last result first, then live findings while a fresh run goes.
 *
 * Not wired into `App.tsx`: copy it into your app when it calls a Detect & Explain function. Declare the function in
 * `bda.manifest.json`, pinned (`"functions": {"detect_and_explain": {"ref": "fn:<tenant>/detect_and_explain@<n>"}}`),
 * and pass the local name and the input.
 *
 * 1. **On load, the last result.** `reuse` answers from the viewer's own recent run of the same call at once, shown
 *    with "as of" its time. Without one, a run starts.
 * 2. **Refresh runs it again** and shows findings as they arrive: the function sends `de.*` events
 *    (`ctx.emit`, runtime contract 1.20.0), `bda.fn.watch` hands them over in `batch.data`, and `bda.fn.reduceDE`
 *    folds them into rows keyed by finding (detected, then superseded under the finding that explains it, or kept,
 *    then with its drivers). The last result stays on screen, dimmed, until the new one ends.
 * 3. **The output is the result.** When the run ends, its output replaces the live rows. Events are for watching.
 *
 * Everything shown is data: rendered as text, never as HTML.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { bda } from '../studio/bda.js'
import { DE_EMPTY, type DEFinding, type DEState, type Invocation } from '../studio/fn.js'
import { BdaError } from '../studio/types.js'

export type DetectExplainLiveProps = {
  /** The local name declared in `bda.manifest.json` `functions`. */
  readonly fn?: string
  readonly input: Record<string, unknown>
  /** How old a last result may be ("6h", at most "24h"). */
  readonly reuse?: string
}

type Row = Record<string, unknown>

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const MAX_ROWS = 20

/** The rows a finished run's output holds: its kept findings (`stages.supersede`), else what detect found. */
export const outputRows = (output: unknown): Row[] => {
  const stages = (output as { stages?: Record<string, unknown> } | undefined)?.stages ?? {}
  const rows = stages.supersede ?? stages.detect
  return Array.isArray(rows) ? (rows.filter((r) => typeof r === 'object' && r !== null) as Row[]) : []
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const segmentText = (segment: Readonly<Record<string, unknown>> | undefined) =>
  Object.entries(segment ?? {})
    .map(([k, v]) => `${k}=${text(v)}`)
    .join(', ') || '(all)'

function FindingRow({ f, all }: { f: DEFinding; all: ReadonlyMap<string, DEFinding> }) {
  return (
    <li className={`de-finding de-${f.status}`} data-k={f.k}>
      <span>{segmentText(f.segment)}</span>
      {f.pct !== undefined ? <span> {f.pct > 0 ? '+' : ''}{text(f.pct)}%</span> : null}
      {f.current !== undefined && f.baseline !== undefined ? <span> ({text(f.current)} vs {text(f.baseline)})</span> : null}
      {f.status === 'kept' ? <strong> kept</strong> : null}
      {f.drivers?.length ? <div className="de-drivers">Drivers: {f.drivers.map((d) => segmentText(d.segment)).join(' · ')}</div> : null}
      {f.supersedes.length ? (
        <ul>
          {f.supersedes.map((k) => {
            const child = all.get(k)
            return child ? <FindingRow key={k} f={child} all={all} /> : null
          })}
        </ul>
      ) : null}
    </li>
  )
}

function LiveFindings({ live }: { live: DEState }) {
  const all = new Map(live.findings.map((f) => [f.k, f]))
  // top level: whatever is not folded under another finding
  const top = live.findings.filter((f) => f.status !== 'superseded' || !f.supersededBy || !all.has(f.supersededBy))
  return (
    <section aria-label="Live findings">
      <div role="progressbar" aria-valuenow={live.progress} aria-valuemin={0} aria-valuemax={100}>
        {live.stage ? `${live.stage} · ` : ''}
        {live.progress}%
      </div>
      {top.length ? (
        <ul className="de-live">{top.slice(0, MAX_ROWS).map((f) => <FindingRow key={f.k} f={f} all={all} />)}</ul>
      ) : (
        <p>Looking for changes…</p>
      )}
    </section>
  )
}

function ResultTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p>No findings.</p>
  const columns = Object.keys(rows[0] ?? {}).slice(0, 6)
  return (
    <table className="de-result">
      <thead>
        <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.slice(0, MAX_ROWS).map((r, i) => (
          <tr key={i}>{columns.map((c) => <td key={c}>{text(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

export function DetectExplainLive({ fn = 'detect_and_explain', input, reuse = '24h' }: DetectExplainLiveProps) {
  const [last, setLast] = useState<Invocation | undefined>(undefined)
  const [live, setLive] = useState<DEState | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const stop = useRef<(() => void) | undefined>(undefined)

  const start = useCallback(
    async (refresh: boolean) => {
      setError(undefined)
      try {
        const started = await bda.fn.call(fn, input, refresh ? { wait: false, refresh: true } : { wait: false, reuse })
        if (TERMINAL.has(started.status)) {
          bda.fn.outputOf(started) // throws in words for a failed or cancelled run
          setLast(started) // a reused answer: the last result, at once
          return
        }
        let state = DE_EMPTY
        setLive(state)
        const watch = bda.fn.watch(started.invocation_id, (batch) => {
          state = bda.fn.reduceDE(batch.data, state)
          setLive(state)
        })
        stop.current = watch.stop
        const final = await watch.done
        bda.fn.outputOf(final) // throws in words for a failed or cancelled run
        setLast(final)
      } catch (e) {
        setError(e instanceof BdaError ? e.message : String(e))
      } finally {
        setLive(undefined)
      }
    },
    [fn, input, reuse],
  )

  useEffect(() => {
    void start(false)
    return () => stop.current?.()
    // on load only: Refresh starts the next run
  }, [])

  const running = live !== undefined
  return (
    <div className="de-live-panel">
      <header>
        {last?.created_at ? <span>As of {new Date(last.created_at).toLocaleString()}</span> : null}
        <button type="button" disabled={running} onClick={() => void start(true)}>
          {running ? 'Running…' : 'Refresh'}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {running ? <LiveFindings live={live} /> : null}
      {last ? (
        <section aria-label="Last result" style={running ? { opacity: 0.5 } : undefined}>
          <ResultTable rows={outputRows(last.output)} />
        </section>
      ) : null}
    </div>
  )
}
