/** Document chrome: sticky title bar with the entity picker (when the spec has an entity) and page controls, panels below, footer. */

import { type ReactNode, useState } from 'react'
import { type EntityOption, useEntityList } from '../data.js'
import { controlEnabled, type Spec } from '../spec.js'
import { DepthPills, DimensionChecks, MeasureSelect } from '../ui.js'

type Props = { spec: Spec; entityId: string | undefined; onEntity: (id: string) => void; children: ReactNode }

export function ReportChrome({ spec, entityId, onEntity, children }: Props) {
  const entity = spec.entity
  const { options, loading, error } = useEntityList(spec)
  const [text, setText] = useState('')

  const commit = (value: string) => {
    const match = /[\w-]{4,}/.exec(value.trim())
    const typed = match?.[0]
    if (typed === undefined) return
    const option = options.find((candidate) => candidate.id === typed || value.startsWith(`${candidate.id} `))
    const id = option?.id ?? typed
    onEntity(id)
    setText(option === undefined ? id : `${option.id} - ${option.label}`)
  }

  return (
    <main className="kit-report">
      <nav className="kit-nav">
        <div className="kit-nav__title">
          {spec.title}
          {entityId === undefined ? '' : ` — ${entityId}`}
        </div>
        <div className="kit-controls">
          {entity !== undefined && controlEnabled(spec, 'entity') ? (
            <>
              <label className="bda-controls__label" htmlFor="kit-entity">
                {entity.label}
              </label>
              <input
                id="kit-entity"
                className="kit-input"
                list="kit-entity-options"
                placeholder={`Enter a ${entity.label.toLowerCase()} id or pick one`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onBlur={(event) => commit(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit(event.currentTarget.value)
                }}
              />
              <datalist id="kit-entity-options">
                {options.map((option) => (
                  <option key={option.id} value={`${option.id} - ${option.label}`}>
                    {option.group} / {option.status}
                  </option>
                ))}
              </datalist>
            </>
          ) : null}
          {spec.family === undefined ? <MeasureSelect spec={spec} /> : null}
          <DepthPills spec={spec} />
        </div>
      </nav>
      <DimensionChecks spec={spec} />
      {entity !== undefined && entityId === undefined ? <Landing spec={spec} options={options} loading={loading} error={error?.message} onPick={(id) => commit(id)} /> : children}
      <footer className="kit-foot">Powered by Bicycle AI</footer>
    </main>
  )
}

function Landing({ spec, options, loading, error, onPick }: { spec: Spec; options: readonly EntityOption[]; loading: boolean; error: string | undefined; onPick: (id: string) => void }) {
  const entity = spec.entity
  if (entity === undefined) return null
  if (error !== undefined) return <div className="bda-state bda-state--error">{error}</div>
  if (loading) return <div className="bda-state">Loading {entity.label.toLowerCase()}s…</div>
  const list = entity.list
  return (
    <section className="bda-card">
      <h2 className="bda-heading">
        {entity.label}s with data since {spec.time.from}
      </h2>
      {spec.decision !== undefined ? <p className="bda-subtle kit-hint">{spec.decision}</p> : null}
      <div className="kit-scroll">
        <table className="bda-table kit-table">
          <thead>
            <tr>
              <th>{entity.label}</th>
              {list?.label !== undefined ? <th>Name</th> : null}
              {list?.group !== undefined ? <th>Group</th> : null}
              {list?.status !== undefined ? <th>Status</th> : null}
              {list?.description !== undefined ? <th>Description</th> : null}
            </tr>
          </thead>
          <tbody>
            {options.map((option) => (
              <tr key={option.id} className="kit-row" onClick={() => onPick(option.id)}>
                <td className="kit-mono">{option.id}</td>
                {list?.label !== undefined ? <td>{option.label}</td> : null}
                {list?.group !== undefined ? <td>{option.group}</td> : null}
                {list?.status !== undefined ? <td>{option.status}</td> : null}
                {list?.description !== undefined ? <td className="kit-desc">{option.description}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
