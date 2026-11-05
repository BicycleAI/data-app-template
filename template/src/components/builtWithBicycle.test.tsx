import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BdaContext } from '../studio/types.js'
import { BUILT_WITH_BICYCLE, BuiltWithBicycle } from './BuiltWithBicycle.js'

afterEach(() => {
  cleanup()
  delete window.__BDA_CONTEXT
})

/** sha256 of the official "Bicycle Logo Green.png". The logo is never redrawn or recoloured. */
const OFFICIAL_LOGO_SHA256 = 'cedeef6e5b74e3ced9efaaffd7291609baef026a95d25af27a823101aa14954c'

describe('BuiltWithBicycle', () => {
  it('is on by default and shows the bundled logo, not a URL', () => {
    expect(BUILT_WITH_BICYCLE).toBe(true)
    render(<BuiltWithBicycle />)
    const src = screen.getByAltText('Bicycle').getAttribute('src') ?? ''
    expect(src).not.toMatch(/^https?:/)
    expect(screen.getByText('Built with')).toBeTruthy()
  })

  it('renders nothing when turned off', () => {
    const { container } = render(<BuiltWithBicycle show={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a white-labelled tenant, whatever show says', () => {
    window.__BDA_CONTEXT = {
      v: 1,
      appId: 'app_demo',
      version: 1,
      apiBase: '/api',
      token: 't',
      expiresAt: '2026-01-01T00:00:00Z',
      theme: 'light',
      brand: { productName: 'Acme Insights' },
    } satisfies BdaContext
    const { container } = render(<BuiltWithBicycle show />)
    expect(container.innerHTML).toBe('')
  })

  it('bundles the official file', () => {
    const bytes = readFileSync(resolve(__dirname, '../assets/bicycle-logo-green.png'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(OFFICIAL_LOGO_SHA256)
  })
})
