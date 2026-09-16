/**
 * Placeholders that hold a widget's shape while its own query is in flight.
 *
 * The point is what they replace. Gating a whole app on
 * `if (data === undefined) return <div>Loading…</div>` throws away the layout
 * the reader is waiting for, and in a hosted frame that blank is the *third*
 * empty state in a row — the viewer's own load, then the frame's, then this.
 * Rendering the cards immediately and filling each one as its query lands
 * leaves the page stable: headings, controls and card edges are there from the
 * first paint, and nothing below them moves when the rows arrive.
 *
 * So size these to the content they stand in for. A skeleton that is shorter
 * than the chart it becomes is worse than no skeleton, because the page jumps
 * when the real thing arrives.
 *
 * Accessibility: the blocks are decorative and hidden from assistive tech.
 * Mark the *region* they sit in with `aria-busy` instead, so a screen reader
 * hears one "busy" rather than a pile of anonymous boxes:
 *
 *   <div className="bda-card" aria-busy={rows === undefined}>
 *
 * `parts.tsx`'s `Widget` wraps this rule for every recipe — see it before
 * reaching for `Skeleton` directly.
 */

type SkeletonProps = {
  /** CSS width. Defaults to filling the container. */
  width?: string
  /** CSS height. Defaults to one line of text. */
  height?: string
  /** Override the corner radius — pass `999px` for a pill, `50%` for a dot. */
  radius?: string
  className?: string
}

/** One shimmering block. The primitive the others are built from. */
export function Skeleton({ width, height, radius, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={className === undefined ? 'bda-skeleton' : `bda-skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
    />
  )
}

/**
 * A paragraph's worth of lines.
 *
 * The last line is short, because real text rarely fills its final line and a
 * stack of equal bars reads as a table rather than as prose.
 */
export function SkeletonText({ lines = 3, width = '100%' }: { lines?: number; width?: string }) {
  return (
    <span className="bda-skeleton-stack" style={{ width }}>
      {Array.from({ length: lines }, (_value, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '62%' : '100%'} />
      ))}
    </span>
  )
}

/**
 * Stands in for a `<Chart>`.
 *
 * Pass the same `height` you pass the chart — that is the whole job. The
 * default matches `Chart`'s own default so the swap is invisible.
 */
export function SkeletonChart({ height = 260 }: { height?: number }) {
  return <Skeleton className="bda-skeleton--chart" height={`${height}px`} />
}

/** Stands in for a `.kit-card` / metric tile: the big number and its label. */
export function SkeletonMetric() {
  return (
    <span className="bda-skeleton-stack bda-skeleton-stack--metric">
      <Skeleton height="30px" width="7ch" />
      <Skeleton height="13px" width="11ch" />
    </span>
  )
}

/**
 * Stands in for a table, header row included.
 *
 * `rows` and `columns` should match what the query returns, so the card does
 * not resize when it does. If the row count varies, pass the page size rather
 * than the largest case — a skeleton that shrinks is better than one that
 * pushes the rest of the page down.
 */
export function SkeletonTable({ rows = 5, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <span className="bda-skeleton-table" aria-hidden="true">
      {Array.from({ length: rows + 1 }, (_value, row) => (
        <span className="bda-skeleton-table__row" key={row}>
          {Array.from({ length: columns }, (_columnValue, column) => (
            <Skeleton
              height={row === 0 ? '11px' : '13px'}
              key={column}
              // The first column is a label and the rest are numbers, so it is
              // the wide one — same rhythm the real table lands in.
              width={column === 0 ? '68%' : '38%'}
            />
          ))}
        </span>
      ))}
    </span>
  )
}
