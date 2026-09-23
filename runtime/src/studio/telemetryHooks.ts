/**
 * `report`, bound to whichever panel the calling component is inside.
 *
 * Kept out of `telemetry.ts` so that module stays free of React and can be
 * called from a plain event handler, a `useEffect`, or the chrome — none of
 * which are always inside a panel.
 */

import { useCallback } from 'react'
import { usePanelMeta } from './contextRegistry.js'
import { report, type TelemetryValue } from './telemetry.js'

export type Report = (
  name: string,
  properties?: Readonly<Record<string, TelemetryValue>>,
  values?: Readonly<Record<string, TelemetryValue>>,
) => void

/**
 * Outside a resolved panel (a fixture rendering a recipe on its own) the panel
 * fields are simply omitted rather than reported as `undefined` — the host
 * drops undefined values anyway, and an event with no panel is still a true
 * statement about something that happened.
 */
export function useReport(): Report {
  const meta = usePanelMeta()
  const panelId = meta?.panelId
  const recipe = meta?.recipe

  return useCallback(
    (name, properties, values) =>
      report(
        name,
        {
          ...(panelId === undefined ? {} : { panelId }),
          ...(recipe === undefined ? {} : { recipe }),
          ...(properties ?? {}),
        },
        values,
      ),
    [panelId, recipe],
  )
}
