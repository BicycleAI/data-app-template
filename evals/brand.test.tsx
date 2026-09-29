/**
 * Branding: every composed app shows the bundled official Bicycle logo, small,
 * unless the spec turns it off (`theme.builtWithBicycle: false`). The logo is
 * a bundled file, never a URL, and never a redrawn or recoloured copy: its
 * bytes are pinned here, and the template's copy must be the same file.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BuiltWithBicycle, showBuiltWith } from '../runtime/src/chrome/BuiltWith.js'
import type { Spec } from '../runtime/src/spec.js'

afterEach(cleanup)

/** sha256 of the official "Bicycle Logo Green.png" (253x48). Change it only when brand ships a new file. */
const OFFICIAL_LOGO_SHA256 = 'cedeef6e5b74e3ced9efaaffd7291609baef026a95d25af27a823101aa14954c'

const sha256 = (path: string) => createHash('sha256').update(readFileSync(resolve(__dirname, path))).digest('hex')

const spec = (theme?: Spec['theme']): Spec => ({
  version: 2,
  model: 'm_demo',
  title: 'Demo',
  persona: 'biz',
  template: 'scorecard',
  time: { from: '2026-01-01', to: '2026-02-01' },
  measures: [{ id: 'orders', column: 'orders', label: 'Orders' }],
  dimensions: [],
  questions: [],
  ...(theme === undefined ? {} : { theme }),
})

describe('Built with Bicycle', () => {
  it('is on by default and off only when the spec says false', () => {
    expect(showBuiltWith(spec())).toBe(true)
    expect(showBuiltWith(spec({ accent: 'teal' }))).toBe(true)
    expect(showBuiltWith(spec({ builtWithBicycle: true }))).toBe(true)
    expect(showBuiltWith(spec({ builtWithBicycle: false }))).toBe(false)
  })

  it('renders the bundled logo, not a URL', () => {
    render(<BuiltWithBicycle />)
    const img = screen.getByAltText('Bicycle')
    const src = img.getAttribute('src') ?? ''
    expect(src).not.toMatch(/^https?:/)
    expect(src).toMatch(/bicycle-logo-green\.png$|^data:image\/png;base64,/)
    expect(screen.getByText('Built with')).toBeTruthy()
  })

  it('ships the official file, byte for byte, in the runtime and the template', () => {
    expect(sha256('../runtime/src/assets/bicycle-logo-green.png')).toBe(OFFICIAL_LOGO_SHA256)
    expect(sha256('../template/src/assets/bicycle-logo-green.png')).toBe(OFFICIAL_LOGO_SHA256)
  })
})
