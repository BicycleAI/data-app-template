/**
 * Who decides light or dark.
 *
 * The rule this pins is the one a person notices: an app opened on a dark
 * desktop is dark, without anyone configuring it, and it stops following the
 * system the moment the app itself says which theme it wants. Getting the
 * precedence backwards is invisible in a light-mode screenshot, which is why
 * it is tested rather than eyeballed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentTheme, initTheme, onThemeChange, pinTheme, resetThemeForTests, systemTheme } from './theme.js'

type MediaListener = (event: { matches: boolean }) => void

/** A `prefers-color-scheme` the test can move. */
function installSystemPreference(dark: boolean): { set: (dark: boolean) => void } {
  const listeners = new Set<MediaListener>()
  let matches = dark
  const list = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_event: string, listener: MediaListener) => {
      listeners.add(listener)
    },
    removeEventListener: (_event: string, listener: MediaListener) => {
      listeners.delete(listener)
    },
  }
  const query = () => list
  vi.stubGlobal('matchMedia', query)
  window.matchMedia = query as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      matches = next
      for (const listener of [...listeners]) listener({ matches: next })
    },
  }
}

function stamped(): string | undefined {
  return document.documentElement.dataset.theme
}

beforeEach(() => {
  resetThemeForTests()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('theme', () => {
  it('follows the system when nothing asks for a theme', () => {
    installSystemPreference(true)
    expect(systemTheme()).toBe('dark')
    expect(initTheme()).toBe('dark')
    expect(stamped()).toBe('dark')
  })

  it('follows the system while the page is open', () => {
    const system = installSystemPreference(false)
    initTheme('system')
    expect(stamped()).toBe('light')

    const seen: string[] = []
    onThemeChange((theme) => seen.push(theme))
    system.set(true)

    expect(stamped()).toBe('dark')
    // Charts read resolved colours out of CSS, so they have to be told.
    expect(seen).toEqual(['dark'])
  })

  it('lets the host override the system', () => {
    const system = installSystemPreference(true)
    expect(initTheme('light')).toBe('light')
    expect(stamped()).toBe('light')

    // Still an override once the system moves under it.
    system.set(false)
    expect(stamped()).toBe('light')
  })

  it('lets the app pin a theme, and keeps it pinned', () => {
    const system = installSystemPreference(false)
    initTheme('system')

    expect(pinTheme('dark')).toBe('dark')
    expect(stamped()).toBe('dark')

    // The system moving is exactly the case that used to undo this.
    system.set(true)
    expect(stamped()).toBe('dark')
    system.set(false)
    expect(stamped()).toBe('dark')
    expect(currentTheme()).toBe('dark')
  })

  it('hands control back to the system when unpinned', () => {
    const system = installSystemPreference(false)
    initTheme('system')
    pinTheme('dark')
    pinTheme('system')

    expect(stamped()).toBe('light')
    system.set(true)
    expect(stamped()).toBe('dark')
  })

  it('ignores a host preference that arrives after the app pinned one', () => {
    // Ordering is not guaranteed: `main.tsx` can pin before `initContext`
    // resolves. The app's choice is the one the user asked for either way.
    installSystemPreference(false)
    pinTheme('dark')
    expect(initTheme('light')).toBe('dark')
    expect(stamped()).toBe('dark')
  })

  it('keeps following after more than one change', () => {
    // The media query list has to be retained. One created per call is
    // collectable, and its listener stops firing after the first switch —
    // which looks exactly like the feature working.
    const system = installSystemPreference(false)
    initTheme('system')
    system.set(true)
    expect(stamped()).toBe('dark')
    system.set(false)
    expect(stamped()).toBe('light')
    system.set(true)
    expect(stamped()).toBe('dark')
  })

  it('attaches one system listener however often it is started', () => {
    const system = installSystemPreference(false)
    initTheme('system')
    initTheme('system')
    initTheme('system')

    const seen: string[] = []
    onThemeChange((theme) => seen.push(theme))
    system.set(true)
    expect(seen).toEqual(['dark'])
  })

  it('stops notifying an unsubscribed listener', () => {
    const system = installSystemPreference(false)
    initTheme('system')
    const seen: string[] = []
    const unsubscribe = onThemeChange((theme) => seen.push(theme))
    unsubscribe()
    system.set(true)
    expect(seen).toEqual([])
  })

  it('falls back to light where there is no media query to ask', () => {
    vi.stubGlobal('matchMedia', undefined)
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    expect(systemTheme()).toBe('light')
    expect(initTheme()).toBe('light')
    expect(stamped()).toBe('light')
  })
})
