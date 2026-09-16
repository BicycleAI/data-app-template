import type { RecipeProps } from '../../../../runtime/src/parts.js'

export function Render({ data }: RecipeProps) {
  return (
    <section className="kit-section">
      <div className="kit-sh">Experiment hypothesis</div>
      <div className="kit-hyp">{data.meta.description.length > 0 ? `“${data.meta.description}”` : 'No hypothesis recorded for this experiment.'}</div>
    </section>
  )
}
