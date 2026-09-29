/**
 * Lessons from real apps, enforced: money in the app's currency (₹ with lakh and crore for INR), rates to one
 * decimal, and a visible banner on sample data.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SAMPLE_BANNER_TEXT, SampleBanner } from '../runtime/src/chrome/SampleBanner.js'
import { type Change, fmtDelta, fmtMeasure } from '../runtime/src/core.js'
import { fmtCompactMoney, fmtSigned, setCurrency } from '../runtime/src/format.js'
import type { Spec } from '../runtime/src/spec.js'

afterEach(() => {
  cleanup()
  setCurrency(undefined)
})

const spec = (extra: Partial<Spec> = {}): Spec => ({
  version: 2,
  model: 'm_demo',
  title: 'Demo',
  persona: 'biz',
  template: 'scorecard',
  time: { from: '2026-01-01', to: '2026-02-01' },
  measures: [{ id: 'orders', column: 'orders', label: 'Orders' }],
  dimensions: [],
  questions: [],
  ...extra,
})

describe('currency', () => {
  it('defaults to USD', () => {
    expect(fmtMeasure(1_234_567, 'currency')).toBe('$1,234,567')
    expect(fmtMeasure(1_234_567, 'currency', true)).toBe('$1.2M')
  })

  it('reads INR the Indian way: lakh grouping in full, L and Cr compact', () => {
    setCurrency('INR')
    expect(fmtMeasure(1_234_567, 'currency')).toBe('₹12,34,567')
    expect(fmtMeasure(420_000, 'currency', true)).toBe('₹4.2 L')
    expect(fmtMeasure(13_000_000, 'currency', true)).toBe('₹1.3 Cr')
    expect(fmtCompactMoney(-233_970)).toBe('−₹2.3 L')
    expect(fmtSigned(233_970, true)).toBe('↑ +₹2,33,970')
  })

  it('uses another currency by its symbol, and ignores a code that is not ISO 4217', () => {
    setCurrency('EUR')
    expect(fmtMeasure(2500, 'currency')).toBe('€2,500')
    setCurrency('rupees')
    expect(fmtMeasure(2500, 'currency')).toBe('$2,500')
  })
})

describe('rates', () => {
  it('show one decimal', () => {
    expect(fmtMeasure(0.03141, 'percent')).toBe('3.1%')
    expect(fmtMeasure(15.66, 'rate')).toBe('15.7%')
    expect(fmtDelta({ recent: 3, previous: 2.54, delta: 0.46, pct: 0.18, periods: 7 } satisfies Change, 'rate')).toBe('+0.5 pts')
  })
})

describe('sample-data banner', () => {
  it('is off by default', () => {
    const { container } = render(<SampleBanner spec={spec()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows when the spec says the data is sample data', () => {
    render(<SampleBanner spec={spec({ sampleData: true })} />)
    expect(screen.getByRole('note').textContent).toContain(SAMPLE_BANNER_TEXT)
  })
})
