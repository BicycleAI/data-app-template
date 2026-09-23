import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { openProvenance } from '../../runtime/src/chrome/Provenance.js'
import { type CoreProps, Widget } from '../../runtime/src/parts.js'
import { currentPanelReports } from '../../runtime/src/studio/contextRegistry.js'
import { isSummarising, requestSummary, type SummaryOutcome, type SummaryRef, type SummaryResult } from '../../runtime/src/studio/summary.js'
import { BdaError } from '../../runtime/src/studio/types.js'

type Status = { readonly phase: 'loading' } | { readonly phase: 'ready'; readonly data: SummaryResult } | { readonly phase: 'error'; readonly code: string; readonly message: string }

/** 1.5s, doubling to a 4s ceiling — how long to wait before asking again while the service answers `summarising`. */
const RETRY_START_MS = 1500
const RETRY_MAX_MS = 4000

/**
 * `[n]` -> a small reference button. Clicking it pulses the panel that
 * figure came from and opens its "How is this computed?" card (see
 * `onRefClick` below); hovering shows the exact SQL and value in a native
 * tooltip either way, so the reference is checkable even when the panel it
 * names isn't on screen right now.
 */
function renderPlain(plain: string, refsById: ReadonlyMap<number, SummaryRef>, onRefClick: (n: number) => void): readonly ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /\[(\d+)\]/g
  let lastIndex = 0
  let key = 0
  for (const match of plain.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) nodes.push(<span key={key++}>{plain.slice(lastIndex, index)}</span>)
    const n = Number(match[1])
    const ref = refsById.get(n)
    nodes.push(
      <button
        type="button"
        className="kit-summary__ref"
        key={key++}
        onClick={() => onRefClick(n)}
        {...(ref === undefined ? {} : { title: `${ref.sql}\n= ${String(ref.value)}` })}
      >
        {`[${n}]`}
      </button>,
    )
    lastIndex = index + match[0].length
  }
  if (lastIndex < plain.length) nodes.push(<span key={key++}>{plain.slice(lastIndex)}</span>)
  return nodes
}

/**
 * T5.4, the `summary` recipe: two layers over the panels already on screen —
 * 3-5 plain sentences a business reader takes in at a glance, every figure
 * carrying a `[n]`, and a "Show the details" layer with each panel's finding,
 * exact figures and method. See `runtime/src/studio/summary.ts` for the
 * request/response contract this renders; nothing here fetches directly.
 *
 * Supersedes `narrative` when both are placed on a template — `compose/resolve.mjs`
 * drops the `narrative` panel in that case, so a spec never shows both.
 */
export function Render(_props: CoreProps) {
  const [status, setStatus] = useState<Status>({ phase: 'loading' })
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let raf1 = 0
    let raf2 = 0
    const controller = new AbortController()

    const attempt = (delayMs: number) => {
      requestSummary(currentPanelReports(), controller.signal)
        .then((outcome: SummaryOutcome) => {
          if (cancelled) return
          if (isSummarising(outcome)) {
            const next = Math.min(delayMs * 2, RETRY_MAX_MS)
            retryTimer = setTimeout(() => attempt(next), delayMs)
            return
          }
          setStatus({ phase: 'ready', data: outcome })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          const bda = error instanceof BdaError ? error : new BdaError('request_failed', 'The summary could not be loaded.', 0)
          if (bda.code === 'aborted') return
          setStatus({ phase: 'error', code: bda.code, message: bda.message })
        })
    }

    // Two animation frames, exactly like `contextRegistry.ts`'s own first
    // report: this panel is typically the first sibling (a leading slot,
    // like `verdict`), so its own mount effect can run before every other
    // panel on the page has registered. Waiting two frames lets the whole
    // initial commit paint — and every other panel's own registration
    // effect run — before this snapshots `currentPanelReports()` for the
    // request's `context`.
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) attempt(RETRY_START_MS)
      })
    })

    return () => {
      cancelled = true
      controller.abort()
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
    // Requested once per mount. The service is cache-first on (as_of, each
    // panel's bind + filters) — see docs/API.md's "## Summary" — so nothing
    // here re-triggers on every control change; a viewer who narrows the
    // app and wants a fresh read reopens the panel, same as any other cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refsById = useMemo(() => new Map((status.phase === 'ready' ? status.data.refs : []).map((ref) => [ref.n, ref] as const)), [status])
  const panelByRef = useMemo(() => {
    const map = new Map<number, string>()
    if (status.phase === 'ready') for (const detail of status.data.details) for (const figure of detail.figures) map.set(figure.ref, detail.panelId)
    return map
  }, [status])

  const onRefClick = (n: number) => {
    const panelId = panelByRef.get(n)
    if (panelId === undefined) return
    // Reuse the highlight mechanism verbatim (`contextRegistry.ts`'s
    // `onHighlight`) — dispatching the very message the host would send
    // pulses the target card and scrolls it into view, exactly as if the
    // host had pointed at it.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:highlight', panelId } }))
    openProvenance(panelId)
  }

  // 404: the app's manifest doesn't declare chat, so the composer shouldn't
  // have placed this panel at all — render nothing rather than an error
  // card (AGENTS.md's "Widgets never blank" is about never going *blank*
  // mid-render, not about a misconfigured panel insisting on a slot).
  if (status.phase === 'error' && status.code === 'chat_not_declared') return null

  const threadId = status.phase === 'ready' ? (status.data.thread_id ?? undefined) : undefined

  return (
    <section className="kit-section">
      <Widget
        className="kit-summary bda-card"
        heading={<div className="kit-sh">Summary</div>}
        pending={status.phase === 'loading'}
        skeleton={{ kind: 'text', lines: 3 }}
        kind="summary"
        threadId={threadId}
      >
        {status.phase === 'ready' ? (
          <div className="kit-summary__body">
            <p className="kit-summary__plain">{renderPlain(status.data.plain, refsById, onRefClick)}</p>
            {status.data.cached === true ? <span className="kit-summary__cached bda-subtle">from earlier today</span> : null}
            <button type="button" className="bda-pill kit-summary__toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((current) => !current)}>
              {detailsOpen ? 'Hide the details' : 'Show the details'}
            </button>
            {detailsOpen ? (
              <div className="kit-summary__details">
                {status.data.details.map((detail) => (
                  <div className="kit-summary__detail" key={detail.panelId}>
                    <div className="kit-summary__detail-say">{detail.say}</div>
                    <p className="kit-summary__detail-finding">{detail.finding}</p>
                    {detail.figures.length > 0 ? (
                      <table className="kit-summary__figures">
                        <tbody>
                          {detail.figures.map((figure) => (
                            <tr key={figure.ref}>
                              <td>{figure.label}</td>
                              <td className="bda-numeric">{figure.value}</td>
                              <td>
                                <button type="button" className="kit-summary__ref" onClick={() => onRefClick(figure.ref)}>
                                  {`[${figure.ref}]`}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    <div className="kit-summary__method bda-subtle">{detail.method}</div>
                  </div>
                ))}
                {status.data.caveats !== undefined && status.data.caveats.length > 0 ? (
                  <div className="kit-summary__caveats bda-subtle">
                    <div className="kit-sh">Caveats</div>
                    <ul>
                      {status.data.caveats.map((caveat, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, unordered list from one response — nothing reorders it
                        <li key={index}>{caveat}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {status.data.follow_ups !== undefined && status.data.follow_ups.length > 0 ? (
                  <div className="kit-summary__followups bda-subtle">
                    <div className="kit-sh">What to look at next</div>
                    <ul>
                      {status.data.follow_ups.map((question, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, unordered list from one response — nothing reorders it
                        <li key={index}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : status.phase === 'error' ? (
          <div className="bda-subtle kit-summary__note">{status.code === 'chat_unavailable' ? "Summary isn't available in this environment." : `Summary isn't available (${status.code}).`}</div>
        ) : null}
      </Widget>
    </section>
  )
}
