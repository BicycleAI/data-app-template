/**
 * A sortable table over one declared query.
 *
 * Kept in the template because it demonstrates the two things every generated
 * app has to get right: sorting goes to the service (only declared columns can
 * be sorted on, so the service is the one that decides), and a refetch dims the
 * existing rows rather than replacing them with a spinner.
 */

import { useState } from 'react'
import { toObjects } from '../studio/client.js'
import { useAppQuery } from '../studio/hooks.js'
import type { Filter, Sort } from '../studio/types.js'

type Column = { readonly field: string; readonly label: string; readonly numeric?: boolean }

type Props = {
  readonly queryId: string
  /** Columns to show, in order. Defaults to whatever the query returns. */
  readonly columns?: readonly Column[]
  readonly filters?: readonly Filter[]
  readonly parameters?: Readonly<Record<string, string | number | boolean | null>>
}

export function DataTable({ queryId, columns, filters, parameters }: Props) {
  const [sort, setSort] = useState<Sort | undefined>(undefined)

  const query = useAppQuery(queryId, {
    ...(parameters === undefined ? {} : { parameters }),
    ...(filters === undefined ? {} : { filters }),
    ...(sort === undefined ? {} : { sort: [sort] }),
  })

  if (query.isPending) return <div className="bda-state">Loading…</div>
  if (query.error !== null) {
    return (
      <div className="bda-state bda-state--error" role="alert">
        {query.error.message}
      </div>
    )
  }

  const result = query.data
  const rows = toObjects(result)
  const shown: readonly Column[] =
    columns ?? result.columns.map((column) => ({ field: column.name, label: column.name }))

  if (rows.length === 0) {
    // Say plainly that there is nothing, rather than showing an empty frame
    // that looks like a loading failure.
    return <div className="bda-state">No rows matched.</div>
  }

  const toggle = (field: string) => {
    setSort((previous) =>
      previous?.field === field
        ? { field, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' },
    )
  }

  return (
    <table className={`bda-table${query.isPlaceholderData ? ' bda-table--stale' : ''}`}>
      <thead>
        <tr>
          {shown.map((column) => (
            <th
              key={column.field}
              className={column.numeric === true ? 'bda-numeric' : undefined}
              aria-sort={
                sort?.field === column.field ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
              }
              onClick={() => toggle(column.field)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') toggle(column.field)
              }}
              tabIndex={0}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          // Rows have no id of their own, so the key is built from the values
          // shown — sorting re-keys rather than reusing a row's DOM state. The
          // index only disambiguates two rows that are identical on screen, and
          // is not the key itself, which is what the rule is guarding against.
          // biome-ignore lint/suspicious/noArrayIndexKey: the values are the key; the index only breaks ties.
          <tr key={`${shown.map((column) => String(row[column.field])).join('\u0001')}#${index}`}>
            {shown.map((column) => (
              <td key={column.field} className={column.numeric === true ? 'bda-numeric' : undefined}>
                {format(row[column.field])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}
