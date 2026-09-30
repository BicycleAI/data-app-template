/**
 * A control the host's chat can see.
 *
 * Call it in the component that draws a control that changes what the page
 * shows (a date row, a filter, a picker in a card's header), and the chat is
 * told the control exists and what it offers: "How many date ranges are
 * there?" gets a plain answer. It is `studio/contextRegistry.ts`'s
 * `registerControl` with the bookkeeping done, as `<Panel>` is for a card:
 * it registers the control on mount, again whenever what you pass changes
 * (compared by value, so an object built inline on every render is fine and
 * options that load after mount are picked up), and unregisters it on
 * unmount.
 *
 * Controls are reported in the order they first register, and React runs
 * effects children first, so call this in the component that draws the
 * control rather than in a parent: then they register in the order they
 * appear. What each control is set to now is the page scope's
 * (`setPageScope`), not this. See README-FOR-AGENTS.md's "Describe the page".
 */

import { useEffect, useMemo } from 'react'
import { type OutlineControl, registerControl, unregisterControl } from '../studio/contextRegistry.js'

export function useReportControl(control: OutlineControl): void {
  // Compared by value: the same control in a new object must not re-register it.
  const key = JSON.stringify(control)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => control, [key])

  // Re-registering keeps the control's place; only unmounting (or a new id) takes it off the page.
  useEffect(() => {
    registerControl(current)
  }, [current])
  useEffect(() => () => unregisterControl(current.id), [current.id])
}
