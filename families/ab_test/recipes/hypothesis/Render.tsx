import { type RecipeProps, Widget, widgetState } from '../../../../runtime/src/parts.js'

/** Waits on `data.meta`. */
export function Render({ data }: RecipeProps) {
  const description = data.meta.rows?.description ?? ''
  return (
    <section className="kit-section">
      <div className="kit-sh">Experiment hypothesis</div>
      <Widget className="kit-hyp" heading={null} skeleton={{ kind: 'text', lines: 2 }} {...widgetState(data.meta)}>
        <div>{description.length > 0 ? `“${description}”` : 'No hypothesis recorded for this experiment.'}</div>
      </Widget>
    </section>
  )
}
