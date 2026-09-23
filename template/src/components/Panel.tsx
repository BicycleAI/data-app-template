/**
 * A card the host's chat can see.
 *
 * Wrap every card in `<Panel>` and the viewer can hover it and "Add to chat",
 * pick it from the page, and hover a bar or point in a `<Chart>` inside it to
 * attach just that data point — with nothing else to write. It is
 * `studio/contextRegistry.ts` with the bookkeeping done: it registers the card
 * on mount, re-reports it whenever what you pass changes, unregisters it on
 * unmount, and answers the host's "show me this panel" (a source chip in an
 * answer) by scrolling the card into view and highlighting it.
 *
 * What the chat is sent is never a picture of the card. It is what you pass
 * here: `title` (what the card is called), `kind`, the `queryId` it draws —
 * so the agent can re-run the real query for the real numbers — and the first
 * few `rows` as a digest, which only tells the agent what the viewer is
 * looking at. Keep `id` stable across renders; a query id is a good choice.
 *
 * The chat itself is the host's (AGENTS.md, invariant 9). Nothing here renders
 * any part of it, and nothing should.
 */

import { createContext, createElement, type ReactNode, useContext, useEffect, useRef } from 'react'
import { onHighlight, registerPanel, unregisterPanel } from '../studio/contextRegistry.js'

/** Rows sent as the panel's digest. The registry trims to ~2 KB after this. */
const DIGEST_ROWS = 20
const HIGHLIGHT_MS = 1600

const PanelContext = createContext<string | undefined>(undefined)

/** The id of the `<Panel>` this component sits in, or undefined outside one. */
export function usePanelId(): string | undefined {
  return useContext(PanelContext)
}

/**
 * The first rows as plain JSON — dates as ISO strings, anything that is not
 * data left out — or undefined when there is nothing to send. Plain JSON on
 * purpose: the digest crosses into the host with `postMessage`, and a value
 * that cannot be cloned there (a function, a DOM node) would throw.
 */
export function digestOf(rows: readonly unknown[] | undefined): unknown[] | undefined {
  if (rows === undefined || rows.length === 0) return undefined
  try {
    const plain = JSON.parse(JSON.stringify(rows.slice(0, DIGEST_ROWS))) as unknown
    return Array.isArray(plain) && plain.length > 0 ? plain : undefined
  } catch {
    return undefined
  }
}

type Props = {
  /** Stable across renders, unique on the page. A query id works. */
  readonly id: string
  /** What the card is called — the chip the viewer sees, and what the agent is told it is. */
  readonly title: string
  /** A short name for what kind of card: `'bar'`, `'line'`, `'table'`, `'kpi'`, `'verdict'`… */
  readonly kind?: string | undefined
  /** The declared query (`bda.manifest.json`) the card draws. */
  readonly queryId?: string | undefined
  /** The rows on screen. Only the first few are sent, and only as a hint. */
  readonly rows?: readonly unknown[] | undefined
  /** How the card maps columns to what it draws, e.g. `{ x: 'month', y: 'revenue' }`. */
  readonly bind?: Readonly<Record<string, unknown>> | undefined
  readonly as?: 'div' | 'section' | 'article' | undefined
  /** False for a group that is not itself a card (a row of metrics). */
  readonly card?: boolean | undefined
  readonly className?: string | undefined
  /** `aria-busy` while the card's query is in flight. */
  readonly busy?: boolean | undefined
  readonly children?: ReactNode | undefined
}

export function Panel({
  id,
  title,
  kind = 'custom',
  queryId,
  rows,
  bind,
  as = 'div',
  card = true,
  className,
  busy,
  children,
}: Props) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const digest = digestOf(rows)
    registerPanel(el, {
      panelId: id,
      recipe: kind,
      say: title,
      ...(queryId === undefined ? {} : { queryId }),
      ...(bind === undefined ? {} : { bind }),
      ...(digest === undefined ? {} : { digest }),
    })
  }, [id, kind, title, queryId, rows, bind])

  useEffect(() => () => unregisterPanel(id), [id])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = onHighlight(id, () => {
      const el = ref.current
      if (el === null) return
      const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      el.classList.add('bda-card--highlight')
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => el.classList.remove('bda-card--highlight'), HIGHLIGHT_MS)
    })
    return () => {
      stop()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [id])

  const classes = [card ? 'bda-card' : '', className ?? ''].filter(Boolean).join(' ')

  return (
    <PanelContext.Provider value={id}>
      {createElement(
        as,
        { ref, className: classes === '' ? undefined : classes, 'aria-busy': busy, 'data-bda-panel': id },
        children,
      )}
    </PanelContext.Provider>
  )
}
