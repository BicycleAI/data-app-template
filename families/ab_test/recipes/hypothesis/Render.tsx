import { provenanceSpec } from '../../../../runtime/src/chrome/Provenance.js'
import { type RecipeProps, Widget, widgetState } from '../../../../runtime/src/parts.js'
import { QUERY } from '../../../../runtime/src/spec.js'

/** Waits on `data.meta`. */
export function Render({ spec, data }: RecipeProps) {
  const description = data.meta.rows?.description ?? ''
  return (
    <section className="kit-section">
      <div className="kit-sh">Experiment hypothesis</div>
      <Widget className="kit-hyp" heading={null} skeleton={{ kind: 'text', lines: 2 }} spec={spec} provenance={provenanceSpec({ queries: [QUERY.meta], measures: [] })} {...widgetState(data.meta)}>
        <div>{description.length > 0 ? `“${description}”` : 'No hypothesis recorded for this experiment.'}</div>
      </Widget>
    </section>
  )
}
