/**
 * A/B incremental maths, parameterised by the spec's field bindings.
 *
 *   w_arm     = participants_arm / participants_total
 *   w_control = participants_control / participants_total
 *   NIBPD     = (orders_arm / w_arm - orders_control / w_control) / effective_tld
 *   NIBrPD    = (bookers_arm / w_arm - bookers_control / w_control) / effective_tld
 *   NICPD     = (value_arm   / w_arm - value_control   / w_control) / effective_tld
 *   CVR       = bookers / participants;  z = two-proportion Z-test on CVR
 */

import type { AbSpec as Spec, Metric } from './spec.js'

export type Row = Record<string, unknown>
export type Confidence = '99%' | '95%' | '90%' | '80%' | '<80%' | 'N/A'

const DAY_MS = 86_400_000

export function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Dates arrive as epoch seconds ("1.788626929E9"), ISO strings, or YYYY-MM-DD. */
export function parseDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return new Date(value > 1e11 ? value : value * 1000)
  const text = String(value).trim()
  const asNumber = Number(text)
  if (Number.isFinite(asNumber) && /^[\d.eE+-]+$/.test(text)) return new Date(asNumber > 1e11 ? asNumber : asNumber * 1000)
  const iso = new Date(text.length === 10 ? `${text}T00:00:00Z` : text)
  return Number.isNaN(iso.getTime()) ? undefined : iso
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function endOfUtcDay(day: string): Date {
  return new Date(`${day}T23:59:59Z`)
}

export function confidence(z: number): Confidence {
  const az = Math.abs(z)
  if (az >= 2.576) return '99%'
  if (az >= 1.96) return '95%'
  if (az >= 1.645) return '90%'
  if (az >= 1.282) return '80%'
  return '<80%'
}

export const CONFIDENCE_ORDER: readonly Confidence[] = ['99%', '95%', '90%', '80%', '<80%']

export function meetsBar(level: Confidence, bar: '80%' | '90%' | '95%' | '99%'): boolean {
  if (level === 'N/A' || level === '<80%') return false
  return CONFIDENCE_ORDER.indexOf(level) <= CONFIDENCE_ORDER.indexOf(bar)
}

export function zTest(bookersV: number, participantsV: number, bookersD: number, participantsD: number): number {
  if (participantsV <= 0 || participantsD <= 0) return 0
  const cvrV = bookersV / participantsV
  const cvrD = bookersD / participantsD
  const pooled = (bookersV + bookersD) / (participantsV + participantsD)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / participantsV + 1 / participantsD))
  return se > 0 ? (cvrV - cvrD) / se : 0
}

export type Window = {
  readonly testStart: Date
  readonly testEnd: Date | undefined
  readonly dataAsOf: string
  readonly effectiveTld: number
  readonly scheduledTld: number | undefined
}

export type Meta = {
  readonly entityId: string
  readonly description: string
  readonly tag: string
  readonly status: string
  readonly group: string
  readonly window: Window
}

export function buildMeta(spec: Spec, entityId: string, metaRows: readonly Row[], trendDays: readonly string[]): Meta | undefined {
  if (metaRows.length === 0 && trendDays.length === 0) return undefined
  const ctx = spec.context ?? {}
  const asOfField = ctx.as_of
  const sorted = asOfField === undefined ? [...metaRows] : [...metaRows].sort((a, b) => str(b[asOfField]).localeCompare(str(a[asOfField])))
  const latest = sorted[0] ?? {}

  const days = [...trendDays].sort()
  const firstDay = days[0]
  const lastDay = days[days.length - 1]

  const testStart =
    (ctx.start === undefined ? undefined : parseDate(latest[ctx.start])) ??
    (firstDay === undefined ? undefined : new Date(`${firstDay}T00:00:00Z`))
  if (testStart === undefined) return undefined
  const testEnd = ctx.end === undefined ? undefined : parseDate(latest[ctx.end])

  const snapshot = asOfField === undefined ? '' : str(latest[asOfField]).slice(0, 10)
  let dataAsOf = snapshot.length === 10 ? snapshot : (lastDay ?? isoDay(testStart))
  if (lastDay !== undefined && lastDay > dataAsOf) dataAsOf = lastDay
  if (testEnd !== undefined && isoDay(testEnd) < dataAsOf) dataAsOf = isoDay(testEnd)

  let asOfEnd = endOfUtcDay(dataAsOf)
  if (testEnd !== undefined && testEnd < asOfEnd) asOfEnd = testEnd
  const effectiveTld = Math.max((asOfEnd.getTime() - testStart.getTime()) / DAY_MS, 1 / 86_400)
  const scheduledTld = testEnd === undefined ? undefined : Math.max((testEnd.getTime() - testStart.getTime()) / DAY_MS, 1 / 86_400)

  return {
    entityId,
    description: ctx.description === undefined ? '' : str(latest[ctx.description]),
    tag: ctx.tag === undefined ? '' : str(latest[ctx.tag]),
    status: ctx.status === undefined ? '' : str(latest[ctx.status]),
    group: ctx.group === undefined ? '' : str(latest[ctx.group]),
    window: { testStart, testEnd, dataAsOf, effectiveTld, scheduledTld },
  }
}

export type Kpis = {
  readonly NIBPD: number | null
  readonly NIBrPD: number | null
  readonly NICPD: number | null
  readonly cvrVariant: number | null
  readonly cvrDefault: number | null
  readonly z: number
  readonly confidence: Confidence
}

type Arm = { bookers: number; orders: number; value: number; participants: number }

export function computeKpis(variant: Arm, control: Arm, total: number, tld: number): Kpis {
  const wv = total > 0 ? variant.participants / total : 0
  const wd = total > 0 ? control.participants / total : 0
  const ok = wv > 0 && wd > 0 && tld > 0
  const z = zTest(variant.bookers, variant.participants, control.bookers, control.participants)
  return {
    NIBPD: ok ? (variant.orders / wv - control.orders / wd) / tld : null,
    NIBrPD: ok ? (variant.bookers / wv - control.bookers / wd) / tld : null,
    NICPD: ok ? (variant.value / wv - control.value / wd) / tld : null,
    cvrVariant: variant.participants > 0 ? variant.bookers / variant.participants : null,
    cvrDefault: control.participants > 0 ? control.bookers / control.participants : null,
    z,
    confidence: variant.participants > 0 && control.participants > 0 ? confidence(z) : 'N/A',
  }
}

export type VariantOverall = {
  readonly name: string
  readonly participants: number
  readonly participantsDefault: number
  readonly participantsTotal: number
  readonly bookers: number
  readonly orders: number
  readonly value: number
  readonly bookersDefault: number
  readonly ordersDefault: number
  readonly valueDefault: number
  readonly kpis: Kpis
}

function isControlName(spec: Spec, name: string): boolean {
  const upper = name.toUpperCase()
  if (upper === '' || upper === spec.arms.control.toUpperCase()) return true
  return (spec.arms.exclude ?? ['CONTROL']).some((excluded) => excluded.toUpperCase() === upper)
}

export function buildOverall(spec: Spec, totalRows: readonly Row[], tld: number): VariantOverall[] {
  const m = spec.measures
  const armField = spec.arms.field
  const control = totalRows.find((row) => str(row[armField]).toUpperCase() === spec.arms.control.toUpperCase())
  const bookersD = num(control?.[m.bookers])
  const ordersD = num(control?.[m.orders])
  const valueD = num(control?.[m.value])
  const participantsD = num(control?.[m.participants.control])
  const total = Math.max(...totalRows.map((row) => num(row[m.participants.total])), 0)

  return totalRows
    .filter((row) => !isControlName(spec, str(row[armField])))
    .map((row) => {
      const participants = num(row[m.participants.arm])
      const bookers = num(row[m.bookers])
      const orders = num(row[m.orders])
      const value = num(row[m.value])
      const participantsTotal = total > 0 ? total : participants + participantsD
      return {
        name: str(row[armField]),
        participants,
        participantsDefault: participantsD,
        participantsTotal,
        bookers,
        orders,
        value,
        bookersDefault: bookersD,
        ordersDefault: ordersD,
        valueDefault: valueD,
        kpis: computeKpis(
          { bookers, orders, value, participants },
          { bookers: bookersD, orders: ordersD, value: valueD, participants: participantsD },
          participantsTotal,
          tld,
        ),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type Segment = {
  readonly variant: string
  readonly dims: readonly string[]
  readonly values: readonly string[]
  readonly label: string
  readonly bookersVariant: number
  readonly bookersDefault: number
  readonly ordersVariant: number
  readonly ordersDefault: number
  readonly valueVariant: number
  readonly valueDefault: number
  readonly NIBPD: number
  readonly NIBrPD: number
  readonly NICPD: number
  readonly z: number
  readonly confidence: Confidence
}

export function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [[]]
  if (items.length < size) return []
  const [head, ...rest] = items
  if (head === undefined) return []
  const withHead = combinations(rest, size - 1).map((combo) => [head, ...combo])
  return [...withHead, ...combinations(rest, size)]
}

const isMissing = (value: string) => {
  const lower = value.trim().toLowerCase()
  return lower === '' || lower === 'nan' || lower === 'none' || lower === 'null' || lower.includes('__missing__')
}

/**
 * Every (arm x dimension-combination x segment) row, rolled up locally from
 * the wide pull. Exact for orders and value; bookers is a distinct count per
 * leaf, so the roll-up is an upper bound.
 */
export function buildSegments(
  spec: Spec,
  wideRows: readonly Row[],
  overall: readonly VariantOverall[],
  dimensions: readonly string[],
  level: number,
  tld: number,
): Segment[] {
  const m = spec.measures
  const armField = spec.arms.field
  const controlName = spec.arms.control.toUpperCase()
  const labelOf = (field: string) => spec.dimensions.find((dim) => dim.field === field)?.label ?? field
  const combos = combinations(dimensions, Math.min(level, dimensions.length))
  const out: Segment[] = []

  for (const dims of combos) {
    type Acc = { bookers: number; orders: number; value: number }
    const byVariant = new Map<string, Map<string, Acc>>()
    const keyValues = new Map<string, string[]>()

    for (const row of wideRows) {
      const variant = str(row[armField]).toUpperCase()
      const values = dims.map((dim) => str(row[dim]))
      if (values.some(isMissing)) continue
      const key = values.join('')
      keyValues.set(key, values)
      let bucket = byVariant.get(variant)
      if (bucket === undefined) {
        bucket = new Map()
        byVariant.set(variant, bucket)
      }
      const acc = bucket.get(key) ?? { bookers: 0, orders: 0, value: 0 }
      acc.bookers += num(row[m.bookers])
      acc.orders += num(row[m.orders])
      acc.value += num(row[m.value])
      bucket.set(key, acc)
    }

    const control = byVariant.get(controlName)
    if (control === undefined) continue

    for (const variant of overall) {
      const bucket = byVariant.get(variant.name.toUpperCase())
      if (bucket === undefined) continue
      const wv = variant.participants / variant.participantsTotal
      const wd = variant.participantsDefault / variant.participantsTotal
      if (!(wv > 0) || !(wd > 0) || !(tld > 0)) continue

      for (const [key, v] of bucket) {
        const d = control.get(key)
        if (d === undefined) continue
        const values = keyValues.get(key) ?? []
        const z = zTest(v.bookers, variant.participants, d.bookers, variant.participantsDefault)
        out.push({
          variant: variant.name,
          dims,
          values,
          label: dims.map((dim, index) => `${labelOf(dim)}=${values[index] ?? ''}`).join(' × '),
          bookersVariant: v.bookers,
          bookersDefault: d.bookers,
          ordersVariant: v.orders,
          ordersDefault: d.orders,
          valueVariant: v.value,
          valueDefault: d.value,
          NIBPD: (v.orders / wv - d.orders / wd) / tld,
          NIBrPD: (v.bookers / wv - d.bookers / wd) / tld,
          NICPD: (v.value / wv - d.value / wd) / tld,
          z,
          confidence: confidence(z),
        })
      }
    }
  }
  return out
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const a = sorted[lower] ?? 0
  const b = sorted[upper] ?? a
  return a + (b - a) * (position - lower)
}

/** Apply the spec's rules: drop the thinnest quartile and anything under min_bookers. */
export function applyRules(spec: Spec, segments: readonly Segment[]): Segment[] {
  const minBookers = spec.rules?.min_bookers ?? 0
  let kept = segments.filter((segment) => segment.bookersVariant >= minBookers)
  if ((spec.rules?.trim_quartile ?? true) && kept.length >= 8) {
    const sorted = kept.map((segment) => segment.bookersVariant).sort((a, b) => a - b)
    const floor = quantile(sorted, 0.25)
    kept = kept.filter((segment) => segment.bookersVariant >= floor)
  }
  return kept
}

export function topLifters(segments: readonly Segment[], metric: Metric, count = 10): Segment[] {
  return segments.filter((segment) => segment[metric] > 0).sort((a, b) => b[metric] - a[metric]).slice(0, count)
}

export function topDraggers(segments: readonly Segment[], metric: Metric, count = 10): Segment[] {
  return segments.filter((segment) => segment[metric] < 0).sort((a, b) => a[metric] - b[metric]).slice(0, count)
}

export type TrendPoint = {
  readonly day: Date
  readonly variant: string
  readonly NIBPD: number | null
  readonly NIBrPD: number | null
  readonly NICPD: number | null
  readonly cvr: number | null
  readonly cvrDefault: number | null
}

/**
 * Cumulative-to-date KPIs per day. Orders, bookers and value are summed from
 * the start; participants are cumulative snapshots carried as a running max.
 */
export function buildTrend(spec: Spec, dailyRows: readonly Row[], overall: readonly VariantOverall[], window: Window): TrendPoint[] {
  const m = spec.measures
  const armField = spec.arms.field
  const controlName = spec.arms.control.toUpperCase()
  const days = [...new Set(dailyRows.map((row) => str(row.day).slice(0, 10)))]
    .filter((day) => day.length === 10 && day <= window.dataAsOf)
    .sort()
  const byDayVariant = new Map<string, Row>()
  for (const row of dailyRows) byDayVariant.set(`${str(row.day).slice(0, 10)}|${str(row[armField]).toUpperCase()}`, row)

  const points: TrendPoint[] = []
  const variantNames = overall.map((variant) => variant.name)
  const runningSums = new Map<string, { bookers: number; orders: number; value: number }>()
  const runningParticipants = new Map<string, number>()
  let runningDefault = 0
  let runningTotal = 0

  const accumulate = (name: string, row: Row | undefined) => {
    const acc = runningSums.get(name) ?? { bookers: 0, orders: 0, value: 0 }
    acc.bookers += num(row?.[m.bookers])
    acc.orders += num(row?.[m.orders])
    acc.value += num(row?.[m.value])
    runningSums.set(name, acc)
    return acc
  }

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index] ?? ''
    const controlRow = byDayVariant.get(`${day}|${controlName}`)
    const control = accumulate(controlName, controlRow)
    runningDefault = Math.max(runningDefault, num(controlRow?.[m.participants.control]))
    runningTotal = Math.max(runningTotal, num(controlRow?.[m.participants.total]))

    const isLast = index === days.length - 1
    const tld = isLast ? window.effectiveTld : Math.max((endOfUtcDay(day).getTime() - window.testStart.getTime()) / DAY_MS, 1 / 86_400)

    for (const name of variantNames) {
      const row = byDayVariant.get(`${day}|${name.toUpperCase()}`)
      const variant = accumulate(name, row)
      const participants = Math.max(runningParticipants.get(name) ?? 0, num(row?.[m.participants.arm]))
      runningParticipants.set(name, participants)
      runningTotal = Math.max(runningTotal, num(row?.[m.participants.total]))
      runningDefault = Math.max(runningDefault, num(row?.[m.participants.control]))
      const total = runningTotal > 0 ? runningTotal : participants + runningDefault
      const wv = total > 0 ? participants / total : 0
      const wd = total > 0 ? runningDefault / total : 0
      const ok = wv > 0 && wd > 0
      points.push({
        day: new Date(`${day}T00:00:00Z`),
        variant: name,
        NIBPD: ok ? (variant.orders / wv - control.orders / wd) / tld : null,
        NIBrPD: ok ? (variant.bookers / wv - control.bookers / wd) / tld : null,
        NICPD: ok ? (variant.value / wv - control.value / wd) / tld : null,
        cvr: participants > 0 ? variant.bookers / participants : null,
        cvrDefault: runningDefault > 0 ? control.bookers / runningDefault : null,
      })
    }
  }
  return points
}

export type Insight = { readonly html: string }

const fmtMetricValue = (metric: Metric, value: number, words: Readonly<Record<string, string>>) => {
  const sign = value >= 0 ? '+' : '−'
  const magnitude = Math.abs(value)
  if (metric === 'NICPD') return `${sign}$${Math.round(magnitude).toLocaleString()}/day`
  const unit = words[metric] === undefined || words[metric] === metric ? (metric === 'NIBPD' ? 'bookings/day' : 'bookers/day') : words[metric]
  return `${sign}${magnitude.toFixed(1)} ${unit}`
}

/**
 * Pattern-level findings: the dimension value that is the common thread through
 * the strongest and weakest segments, how broad the effect is, and where volume
 * and commerce disagree. Deterministic. Every dynamic string is escaped.
 */
export function buildInsights(
  segments: readonly Segment[],
  metric: Metric,
  description: string,
  words: Readonly<Record<string, string>> = {},
  labelOf: (field: string) => string = (field) => field,
): { working: Insight[]; attention: Insight[] } {
  const working: Insight[] = []
  const attention: Insight[] = []
  if (segments.length === 0) return { working, attention }

  const positive = segments.filter((segment) => segment[metric] > 0)
  const negative = segments.filter((segment) => segment[metric] < 0)
  const share = Math.round((positive.length / segments.length) * 100)
  const unit = metric === 'NICPD' ? 'net commerce' : metric === 'NIBPD' ? 'bookings' : 'bookers'
  const hypothesis = description.length === 0 ? '' : ` (“${escapeHtml(description.slice(0, 90))}${description.length > 90 ? '…' : ''}”)`

  working.push({
    html: `<b>${share}% of ${segments.length.toLocaleString()} segments</b> show incremental ${unit}. ${
      share >= 60
        ? `The lift is <b>broad-based</b> rather than concentrated, which is what the hypothesis predicts${hypothesis}.`
        : share >= 45
          ? 'The picture is <b>mixed</b>: gains and losses are roughly balanced, so the aggregate depends on which cohorts carry volume.'
          : 'Lift is <b>narrow</b>; most cohorts are flat or negative, so the aggregate result is being carried by a few segments.'
    }`,
  })

  for (const thread of commonThreads(positive, metric, 'desc', labelOf).slice(0, 2)) {
    working.push({
      html: `<b>${escapeHtml(thread.label)}</b> is the common thread across the top lifters: it appears in <b>${thread.count} of the top ${thread.of}</b> segments, averaging <b>${fmtMetricValue(metric, thread.mean, words)}</b>. If shipped, expect the gain to persist wherever this cohort is present.`,
    })
  }

  const divergent = segments.filter((segment) => segment.NIBPD > 0 && segment.NICPD < 0).sort((a, b) => a.NICPD - b.NICPD).slice(0, 1)
  for (const segment of divergent) {
    attention.push({
      html: `Volume and profitability disagree in <b>${escapeHtml(segment.label)}</b>: <b>${fmtMetricValue('NIBPD', segment.NIBPD, words)}</b> but <b>${fmtMetricValue('NICPD', segment.NICPD, words)}</b>. The change grows booking counts here while lowering net value per booking; check the deal mix before shipping.`,
    })
  }

  for (const thread of commonThreads(negative, metric, 'asc', labelOf).slice(0, 2)) {
    const thin = thread.meanBookers < 2_500
    attention.push({
      html: `<b>${escapeHtml(thread.label)}</b> is a <b>systematic drag</b>: ${thread.count} of the bottom ${thread.of} segments involve it, averaging <b>${fmtMetricValue(metric, thread.mean, words)}</b>. ${
        thin
          ? 'These are thin cohorts (under 2,500 bookers per arm), directionally negative but not yet actionable; monitor if the test extends.'
          : 'Worth investigating whether the experiment change interferes with this cohort specifically.'
      }`,
    })
  }
  if (attention.length === 0) {
    attention.push({
      html: `No cohort shows a <b>systematic</b> negative pattern on ${escapeHtml(words[metric] ?? metric)}; the draggers are isolated segments rather than a shared dimension value. Monitor rather than act.`,
    })
  }
  return { working, attention }
}

function commonThreads(pool: readonly Segment[], metric: Metric, direction: 'asc' | 'desc', labelOf: (field: string) => string) {
  const ranked = [...pool].sort((a, b) => (direction === 'desc' ? b[metric] - a[metric] : a[metric] - b[metric])).slice(0, 25)
  const tally = new Map<string, { count: number; sum: number; bookers: number }>()
  for (const segment of ranked) {
    segment.dims.forEach((dim, index) => {
      const label = `${labelOf(dim)}=${segment.values[index] ?? ''}`
      const entry = tally.get(label) ?? { count: 0, sum: 0, bookers: 0 }
      entry.count += 1
      entry.sum += segment[metric]
      entry.bookers += segment.bookersVariant
      tally.set(label, entry)
    })
  }
  return [...tally.entries()]
    .filter(([, entry]) => entry.count >= Math.max(3, Math.ceil(ranked.length * 0.3)))
    .map(([label, entry]) => ({ label, count: entry.count, of: ranked.length, mean: entry.sum / entry.count, meanBookers: entry.bookers / entry.count }))
    .sort((a, b) => b.count - a.count || Math.abs(b.mean) - Math.abs(a.mean))
}
