/**
 * "Built with Bicycle": the official logo, small. Keep it in every app.
 *
 * The PNG is bundled (`../assets/bicycle-logo-green.png`); Vite inlines it
 * into `app.js` as a `data:` URI, so it loads under the frame's CSP and in the
 * snapshot renderer with no network. Never hotlink, redraw or recolour it. Its
 * wordmark is white, so it sits on its own dark chip (`--bda-brand-chip`) in
 * both themes.
 *
 * The one config point is `BUILT_WITH_BICYCLE`: set it to false only when the
 * person asks for no branding.
 */

import logo from '../assets/bicycle-logo-green.png'

export const BUILT_WITH_BICYCLE = true

export function BuiltWithBicycle({ show = BUILT_WITH_BICYCLE }: { show?: boolean }) {
  if (!show) return null
  return (
    <span className="bda-builtwith">
      <span className="bda-builtwith__text">Built with</span>
      <img className="bda-builtwith__logo" src={logo} alt="Bicycle" width={63} height={12} />
    </span>
  )
}
