/** "Sample data — illustrative": shown at the top of every chrome when `spec.sampleData` is true (default false). */

import type { Spec } from '../spec.js'

export const SAMPLE_BANNER_TEXT = 'Sample data — illustrative'

export function SampleBanner({ spec }: { spec: Spec }) {
  if (spec.sampleData !== true) return null
  return (
    <div className="kit-sample" role="note">
      <strong>{SAMPLE_BANNER_TEXT}</strong>
      <span className="bda-subtle"> · these numbers are not real data</span>
    </div>
  )
}
