import { useMemo } from 'react'
import { buildFindings, type Slice } from '../../runtime/src/core.js'
import type { CoreProps } from '../../runtime/src/parts.js'

/** Deterministic findings: how each measure moved, and where a dimension concentrates or diverges. */
export function Render({ spec, core }: CoreProps) {
  const findings = useMemo(() => {
    const byDim = new Map<string, readonly Slice[]>()
    for (const dim of spec.dimensions.slice(0, 4)) byDim.set(dim.field, core.slicesAt([dim.field]))
    return buildFindings(spec, core.totals, core.series, byDim, spec.rules?.compare_periods ?? 7)
  }, [spec, core])
  if (findings.length === 0) return null
  return (
    <section className="kit-section">
      <div className="kit-sh">What stands out</div>
      <div className="bda-card kit-icard">
        <ul>
          {findings.map((finding, index) => (
            <li key={index} className={`kit-finding kit-finding--${finding.tone}`}>
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally with every value escaped */}
              <span dangerouslySetInnerHTML={{ __html: finding.html }} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
