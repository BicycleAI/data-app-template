/** Surface chrome: sidebar with a searchable entity list (when the spec has an entity) and page controls, panels on the right. */

import { type ReactNode, useMemo, useState } from 'react'
import { type EntityOption, useEntityList } from '../data.js'
import { controlEnabled, type Spec } from '../spec.js'
import { DepthPills, DimensionChecks, MeasureSelect } from '../ui.js'
import { FilterBar } from './FilterBar.js'

type Props = { spec: Spec; entityId: string | undefined; onEntity: (id: string) => void; children: ReactNode }

export function ExplorerChrome({ spec, entityId, onEntity, children }: Props) {
  const entity = spec.entity
  const { options, loading, error } = useEntityList(spec)
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle.length === 0) return options
    return options.filter((option) => [option.id, option.label, option.description, option.group].some((text) => text.toLowerCase().includes(needle)))
  }, [options, search])

  return (
    <div className="kit-xp">
      <aside className="kit-side">
        <div className="kit-brand">
          <span className="kit-brand__mark" />
          {spec.title}
        </div>
        {entity !== undefined && controlEnabled(spec, 'entity') ? (
          <>
            <input
              className="kit-search"
              type="search"
              placeholder="Search id, name, group…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                const typed = /[\w-]{4,}/.exec(event.currentTarget.value)?.[0]
                if (typed !== undefined) onEntity(typed)
              }}
            />
            <div className="kit-side__label">
              {entity.label}s <span className="bda-subtle">{filtered.length}</span>
            </div>
            <div className="kit-list">
              {loading ? <div className="bda-state">Loading…</div> : null}
              {error !== null ? <div className="bda-state bda-state--error">{error.message}</div> : null}
              {filtered.map((option) => (
                <EntityItem key={option.id} option={option} active={option.id === entityId} onPick={onEntity} />
              ))}
            </div>
          </>
        ) : null}
        {controlEnabled(spec, 'measure') ? (
          <>
            <div className="kit-side__label">Measure</div>
            <MeasureSelect spec={spec} />
          </>
        ) : null}
        <DepthPills spec={spec} />
        <DimensionChecks spec={spec} />
        <div className="kit-side__foot">Powered by Bicycle AI</div>
      </aside>
      <main className="kit-main">
        <FilterBar spec={spec} />
        {entity !== undefined && entityId === undefined ? (
          <div className="kit-empty">
            <h1 className="kit-h1">{spec.decision ?? spec.title}</h1>
            <p className="bda-subtle">Pick a {entity.label.toLowerCase()} on the left. Everything on this page is computed from its data.</p>
            <div className="kit-chips">
              {options.slice(0, 6).map((option) => (
                <button key={option.id} type="button" className="kit-chip" onClick={() => onEntity(option.id)}>
                  <strong>{option.label}</strong>
                  <span className="bda-subtle">{option.group}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}

function EntityItem({ option, active, onPick }: { option: EntityOption; active: boolean; onPick: (id: string) => void }) {
  return (
    <button type="button" className="kit-item" aria-pressed={active} onClick={() => onPick(option.id)} title={option.description}>
      <span className="kit-item__tag">{option.label}</span>
      <span className="kit-item__meta">
        <span className="kit-mono">{option.id}</span>
        {option.group.length > 0 ? <span>· {option.group}</span> : null}
      </span>
    </button>
  )
}
