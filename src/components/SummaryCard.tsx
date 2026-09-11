/**
 * The AI summary an agent published for this app.
 *
 * Nothing here generates prose. Claude, Codex or whatever else drives the
 * studio's MCP tools reads `summary_facts`, writes the text, and calls
 * `summary_publish`; this renders what came back.
 *
 * Three states, and the differences matter:
 *
 *   - **No summary** (`summary === null`): render nothing. Most apps have never
 *     had the tools run against them, and an empty card explaining that would
 *     be noise on every one of them.
 *   - **Loading** (`summary === undefined`): a skeleton, because the card owns
 *     space at the top of the page and the layout would otherwise jump.
 *   - **Published**: the prose, plus who wrote it and over what window.
 *
 * The provenance row is not decoration. A reader deciding whether to act on a
 * generated sentence needs to know which window it describes and whether the
 * numbers have moved since — which is what the `stale` badge is for, and why
 * "unknown" is shown as its own state rather than quietly as "current".
 */

import type { AppSummary } from '../studio/types.js'
import { Skeleton, SkeletonText } from './Skeleton.js'

type Props = {
  /** `undefined` while loading, `null` when the app has no summary. */
  readonly summary: AppSummary | null | undefined
}

const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function when(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : WHEN.format(at)
}

/** A date the service echoes back as it was given; show it, do not reformat it blindly. */
function day(value: string): string {
  const at = new Date(value)
  return Number.isNaN(at.getTime())
    ? value
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function StaleBadge({ stale }: { readonly stale: boolean | null }) {
  if (stale === null) {
    // Published without a facts digest, so nobody can tell. Saying "current"
    // here would be a claim the service never made.
    return <span className="bda-badge">Freshness unknown</span>
  }
  return stale ? (
    <span className="bda-badge bda-badge--bad">Data has moved since</span>
  ) : (
    <span className="bda-badge bda-badge--good">Current</span>
  )
}

export function SummaryCard({ summary }: Props) {
  if (summary === null) return null

  if (summary === undefined) {
    return (
      <section className="bda-summary" aria-busy="true" aria-label="AI summary">
        <Skeleton width="7rem" height="1rem" />
        <SkeletonText lines={1} />
        <SkeletonText lines={3} />
      </section>
    )
  }

  return (
    <section className="bda-summary" aria-label="AI summary">
      <span className="bda-badge bda-badge--info">AI summary</span>
      <h2 className="bda-summary__headline">{summary.headline}</h2>
      <ul className="bda-summary__bullets">
        {summary.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <p className="bda-summary__foot">
        <span>
          {day(summary.range.from)} – {day(summary.range.to)}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          written by {summary.writer.length > 0 ? summary.writer : 'an agent'} on {when(summary.generatedAt)}
        </span>
        <StaleBadge stale={summary.stale} />
      </p>
    </section>
  )
}
