/**
 * "Built with Bicycle": the official logo, small, in the chrome's footer.
 *
 * The PNG is bundled (`../assets/bicycle-logo-green.png`) and Vite inlines it
 * into `app.js` as a `data:` URI, so it renders under the frame's CSP and in
 * the snapshot renderer with no network. Never hotlink, redraw or recolour it:
 * its wordmark is white, so it always sits on its own dark chip
 * (`--bda-brand-chip`), the same in both themes.
 *
 * One config point: `spec.theme.builtWithBicycle` (default true).
 */

import logo from '../assets/bicycle-logo-green.png'
import type { Spec } from '../spec.js'

export function showBuiltWith(spec: Spec): boolean {
  return spec.theme?.builtWithBicycle !== false
}

export function BuiltWithBicycle() {
  return (
    <span className="kit-builtwith">
      <span className="kit-builtwith__text">Built with</span>
      <img className="kit-builtwith__logo" src={logo} alt="Bicycle" width={63} height={12} />
    </span>
  )
}
