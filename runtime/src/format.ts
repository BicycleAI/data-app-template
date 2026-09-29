/**
 * Money is in the app's currency: `spec.currency` (ISO 4217, default USD), set once at boot by `setCurrency`.
 * INR reads the Indian way: ₹12,34,567 in full, ₹4.2 L and ₹1.3 Cr compact.
 */
let currency = 'USD'

export function setCurrency(code: string | undefined): void {
  currency = code !== undefined && /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

export function currencySymbol(): string {
  if (currency === 'INR') return '₹'
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')
    return part?.value ?? `${currency} `
  } catch {
    return `${currency} `
  }
}

/** A money value: full (`₹12,34,567`, `$1,234,567`) or compact (`₹12.3 L`, `$1.2M`). */
export function fmtMoney(value: number, compact = false): string {
  const sign = value < 0 ? '−' : ''
  const magnitude = Math.abs(value)
  const symbol = currencySymbol()
  if (currency === 'INR') {
    if (!compact) return `${sign}${symbol}${Math.round(magnitude).toLocaleString('en-IN')}`
    if (magnitude >= 10_000_000) return `${sign}${symbol}${(magnitude / 10_000_000).toFixed(1)} Cr`
    if (magnitude >= 100_000) return `${sign}${symbol}${(magnitude / 100_000).toFixed(1)} L`
    if (magnitude >= 1000) return `${sign}${symbol}${(magnitude / 1000).toFixed(1)}k`
    return `${sign}${symbol}${magnitude.toFixed(0)}`
  }
  if (!compact) return `${sign}${symbol}${Math.round(magnitude).toLocaleString('en-US')}`
  if (magnitude >= 1_000_000) return `${sign}${symbol}${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1000) return `${sign}${symbol}${(magnitude / 1000).toFixed(0)}k`
  return `${sign}${symbol}${magnitude.toFixed(0)}`
}

export function fmtSigned(value: number | null, money: boolean, arrows = true): string {
  if (value === null) return '—'
  const arrow = arrows ? (value >= 0 ? '↑ ' : '↓ ') : ''
  const sign = value >= 0 ? '+' : '−'
  const magnitude = Math.abs(value)
  if (money) return `${arrow}${sign}${fmtMoney(magnitude).replace(/^−/, '')}`
  return `${arrow}${sign}${magnitude >= 100 ? Math.round(magnitude).toLocaleString() : magnitude.toFixed(magnitude >= 10 ? 1 : 2)}`
}

export function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function fmtCompact(value: number): string {
  const sign = value < 0 ? '−' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toFixed(magnitude >= 10_000 ? 0 : 1)}k`
  return `${sign}${Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(magnitude < 10 ? 1 : 0)}`
}

export function fmtCompactMoney(value: number): string {
  return fmtMoney(value, true)
}

export function fmtDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

export function fmtInt(value: number): string {
  return Math.round(value).toLocaleString()
}
