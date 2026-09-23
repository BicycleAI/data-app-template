/**
 * A shared link restores what the sharer was looking at — and nothing else.
 *
 * The round trip matters, but the cases worth holding are the ones a link can
 * be made to say: a value the filter never offered, a preset the app does not
 * use, half a date range. The URL is editable by anyone who has it, so a bad
 * link has to open the app at its defaults rather than narrowed to something
 * that is not on offer.
 */

import { describe, expect, it } from 'vitest'

import { initialFilters, initialTime } from '../controls.js'
import type { Spec } from '../spec.js'
import { decodeViewState, encodeViewState } from './viewState.js'

const NOW = new Date('2026-09-22T00:00:00Z')

const SPEC = {
  version: 2,
  model: 'm_x',
  title: 'T',
  persona: 'pm',
  template: 'report',
  time: { column: 'event_time', from: '2026-08-01', to: 'tomorrow', grain: 'day' },
  measures: [{ id: 'orders', column: 'orders_total', label: 'Orders', role: 'primary' }],
  dimensions: [{ field: 'region', label: 'Region' }, { field: 'channel', label: 'Channel' }],
  questions: [{ say: 'How many?', recipe: 'kpis' }],
  panels: [{ recipe: 'kpis' }],
  controls: [
    { kind: 'filter', dim: 'region', multi: true, options: ['emea', 'amer', 'apac'] },
    { kind: 'filter', dim: 'channel', options: ['web', 'app'] },
    { kind: 'time', presets: ['7d', '30d'] },
  ],
} as unknown as Spec

const base = () => ({ filters: initialFilters(SPEC), time: initialTime(SPEC, NOW) })

describe('encode', () => {
  it('writes nothing for an app nobody has touched', () => {
    // So the link a viewer copies before changing anything is the plain app URL.
    expect(encodeViewState(SPEC, base(), NOW)).toEqual({})
  })

  it('writes only the filter that moved', () => {
    const state = { ...base(), filters: { ...initialFilters(SPEC), region: ['amer'] } }
    expect(encodeViewState(SPEC, state, NOW)).toEqual({ f_region: 'amer' })
  })

  it('writes a preset by name, and an explicit range as dates', () => {
    expect(encodeViewState(SPEC, { ...base(), time: { from: '2026-09-01', to: '2026-09-07', preset: '7d' } }, NOW)).toEqual({ t: '7d' })
    expect(encodeViewState(SPEC, { ...base(), time: { from: '2026-09-01', to: '2026-09-07' } }, NOW)).toEqual({
      from: '2026-09-01',
      to: '2026-09-07',
    })
  })

  it('does not care what order the values are in', () => {
    const state = { ...base(), filters: { ...initialFilters(SPEC), region: ['apac', 'emea', 'amer'] } }
    // The same set as the default, so nothing to say.
    expect(encodeViewState(SPEC, state, NOW)).toEqual({})
  })
})

describe('decode', () => {
  it('restores what encode wrote', () => {
    const state = { filters: { ...initialFilters(SPEC), region: ['amer', 'apac'] }, time: { from: '2026-09-01', to: '2026-09-07' } }
    const back = decodeViewState(SPEC, encodeViewState(SPEC, state, NOW), NOW)
    expect(back.filters?.region).toEqual(['amer', 'apac'])
    expect(back.time).toEqual({ from: '2026-09-01', to: '2026-09-07' })
  })

  it('drops a value the filter never offered', () => {
    expect(decodeViewState(SPEC, { f_region: 'atlantis' }, NOW).filters).toBeUndefined()
    expect(decodeViewState(SPEC, { f_region: 'amer,atlantis' }, NOW).filters?.region).toEqual(['amer'])
  })

  it('ignores a dimension the app has no filter for', () => {
    expect(decodeViewState(SPEC, { f_nonsense: 'x' }, NOW).filters).toBeUndefined()
  })

  it('gives a single-select filter one value however many the link carried', () => {
    expect(decodeViewState(SPEC, { f_channel: 'web,app' }, NOW).filters?.channel).toEqual(['web'])
  })

  it('drops a preset the app does not offer', () => {
    expect(decodeViewState(SPEC, { t: 'ytd' }, NOW).time).toBeUndefined()
    expect(decodeViewState(SPEC, { t: '30d' }, NOW).time?.preset).toBe('30d')
  })

  it('drops a date range that is half given, malformed or backwards', () => {
    expect(decodeViewState(SPEC, { from: '2026-09-01' }, NOW).time).toBeUndefined()
    expect(decodeViewState(SPEC, { from: 'yesterday', to: 'today' }, NOW).time).toBeUndefined()
    expect(decodeViewState(SPEC, { from: '2026-09-30', to: '2026-09-01' }, NOW).time).toBeUndefined()
  })

  it('survives a value containing the separator', () => {
    const spec = {
      ...SPEC,
      dimensions: [{ field: 'city', label: 'City' }],
      controls: [{ kind: 'filter', dim: 'city', multi: true, options: ['New York, NY', 'Paris'] }],
    } as unknown as Spec
    const state = { filters: { city: ['New York, NY'] }, time: initialTime(spec, NOW) }
    const back = decodeViewState(spec, encodeViewState(spec, state, NOW), NOW)
    expect(back.filters?.city).toEqual(['New York, NY'])
  })
})
