import { useMemo } from 'react'
import { provenanceSpec } from '../../runtime/src/chrome/Provenance.js'
import { buildFindings, type Slice } from '../../runtime/src/core.js'
import { mergeQueries } from '../../runtime/src/data.js'
import { type CoreProps, Widget, widgetState } from '../../runtime/src/parts.js'
import { QUERY } from '../../runtime/src/spec.js'

/** Deterministic findings: how each measure moved, and where a dimension concentrates or diverges. Waits on `totals` + `series` + `dims`. */
export function Render({ spec, core }: CoreProps) {
  const query = mergeQueries(core.totals, core.series, core.dims)
  const findings = useMemo(() => {
    const byDim = new Map<string, readonly Slice[]>()
    for (const dim of spec.dimensions.slice(0, 4)) byDim.set(dim.field, core.slicesAt([dim.field]))
    return buildFindings(spec, core.totals.rows ?? {}, core.series.rows ?? [], byDim, spec.rules?.compare_periods ?? 7)
  }, [spec, core])
  if (!query.isPending && findings.length === 0) return null
  return (
    <section className="kit-section">
      <div className="kit-sh">What stands out</div>
      <Widget
        className="bda-card kit-icard"
        heading={null}
        skeleton={{ kind: 'text', lines: 4 }}
        spec={spec}
        provenance={provenanceSpec({ queries: [QUERY.totals, QUERY.byTime, QUERY.byDimension], measures: spec.measures.map((measure) => measure.id) })}
        {...widgetState(query, findings.length)}
      >
        {findings.length === 0 ? (
          <div className="bda-state">Nothing stands out yet.</div>
        ) : (
          <ul>
            {findings.map((finding, index) => (
              <li key={index} className={`kit-finding kit-finding--${finding.tone}`}>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally with every value escaped */}
                <span dangerouslySetInnerHTML={{ __html: finding.html }} />
              </li>
            ))}
          </ul>
        )}
      </Widget>
    </section>
  )
}
