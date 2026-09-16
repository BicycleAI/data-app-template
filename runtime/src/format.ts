export function fmtSigned(value: number | null, currency: boolean, arrows = true): string {
  if (value === null) return '—'
  const arrow = arrows ? (value >= 0 ? '↑ ' : '↓ ') : ''
  const sign = value >= 0 ? '+' : '−'
  const magnitude = Math.abs(value)
  if (currency) return `${arrow}${sign}$${Math.round(magnitude).toLocaleString()}`
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
  const sign = value < 0 ? '−' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1000) return `${sign}$${(magnitude / 1000).toFixed(0)}k`
  return `${sign}$${magnitude.toFixed(0)}`
}

export function fmtDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

export function fmtInt(value: number): string {
  return Math.round(value).toLocaleString()
}
