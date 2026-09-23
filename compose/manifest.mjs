/**
 * A spec's manifest: the declared datasets, rendered, plus the limits the
 * hosting service enforces.
 *
 * There is no SQL in this file. Which queries exist and what they select is
 * declared in `recipes/datasets.json` and `families/<kind>/datasets.json`;
 * `datasets.mjs` renders them. Changing a query is a change to JSON in this
 * repository, and reaches the service through a kit release — never through a
 * code change on the service side.
 */

import { datasetsFor } from './catalogue.mjs'
import { filtersOf, renderDatasets } from './datasets.mjs'

export function deriveManifest(spec) {
  const manifest = {
    appId: spec.appId ?? '',
    entry: 'app.js',
    styles: ['app.css'],
    title: spec.title,
    queries: renderDatasets(spec, datasetsFor(spec)),
  }
  // Controls are declared like queries, and for the same reason: something outside the
  // app has to act on them without understanding it. The queries already carry the
  // parameters — `region_0`, `region_1` — but nothing said those three are the `region`
  // filter, that it takes several values, or which values are legal. A viewer sharing a
  // link, and a schedule pinning `country = India`, both need exactly that.
  const controls = controlsOf(spec)
  if (controls !== undefined) manifest.controls = controls
  // Persistence is declared like queries: only what the manifest names is served.
  if (spec.store?.cache !== undefined) {
    manifest.cache = { ttlSeconds: spec.store.cache.ttl_seconds ?? 86400, maxValueBytes: spec.store.cache.max_value_bytes ?? 65536, writableBy: spec.store.cache.writable_by ?? 'viewer' }
  }
  if ((spec.store?.blobs ?? []).length > 0) {
    manifest.blobs = spec.store.blobs.map((blob) => ({ name: blob.name, kind: blob.kind ?? 'json', maxBytes: blob.max_bytes ?? 10485760, purpose: blob.purpose }))
  }
  // The runtime always reports panel context (invariant 9: it never renders chat
  // itself); this just tells the host whether *it* may offer a chat for this app.
  if (spec.chat !== undefined) {
    manifest.chat = { enabled: spec.chat.enabled, anchors: spec.chat.anchors ?? ['panel'] }
  }

  // Same declare-or-refuse bargain, and the same split the host enforces: `enabled` turns
  // reporting on, `values` decides whether the numbers a panel is showing may travel with it.
  if (spec.telemetry !== undefined) {
    manifest.telemetry = { enabled: spec.telemetry.enabled, values: spec.telemetry.values ?? false }
  }
  return manifest
}

/**
 * What a viewer can change, named so the host and a scheduler can act on it.
 *
 * `slots` is the contract that matters: the query parameters this filter binds, in
 * order, exactly as `filtersOf` renders them. Bind them and the app is narrowed; read
 * them back and you know what it was narrowed to. `default` is what an unset link
 * loads, so "no filter in the URL" and "the filter at its default" stay the same app.
 */
function controlsOf(spec) {
  const declared = spec.controls ?? []
  const label = (field) => spec.dimensions.find((dimension) => dimension.field === field)?.label ?? field
  const filters = filtersOf(spec).map((filter) => {
    const control = declared.find((c) => c.kind === 'filter' && c.dim === filter.dim)
    return {
      dim: filter.dim,
      label: label(filter.dim),
      multi: control?.multi === true,
      slots: filter.parameters.map((parameter) => parameter.name),
      options: (control?.options ?? []).map(String),
      default: filter.parameters.map((parameter) => parameter.default),
    }
  })
  const timeControl = declared.find((c) => c.kind === 'time')
  // The schema's own defaults, applied here rather than left out: a scheduler reading
  // this manifest should not have to know what the schema would have filled in.
  const time = {
    column: spec.time.column ?? 'timestamp',
    from: spec.time.from,
    to: spec.time.to,
    grain: spec.time.grain ?? 'day',
    ...(timeControl?.presets === undefined ? {} : { presets: [...timeControl.presets] }),
  }
  return filters.length === 0 && timeControl === undefined ? { time } : { time, filters }
}

/**
 * The service's own contract, checked here so a failure is local and readable.
 * The service enforces these again on upload; this copy is a courtesy, not the
 * authority.
 */
export function checkManifest(manifest) {
  const errors = []
  if (manifest.queries.length > 32) errors.push(`${manifest.queries.length} queries; the limit is 32`)
  const blobNames = (manifest.blobs ?? []).map((blob) => blob.name)
  if (new Set(blobNames).size !== blobNames.length) errors.push('blob names must be unique')
  if (blobNames.length > 16) errors.push(`${blobNames.length} blobs; the limit is 16`)
  const ids = new Set()
  for (const query of manifest.queries) {
    if (ids.has(query.id)) errors.push(`duplicate query id "${query.id}"`)
    ids.add(query.id)
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(query.id)) errors.push(`query id "${query.id}" is invalid`)
    if (query.sql.length > 8000) errors.push(`query "${query.id}" SQL is longer than 8000 characters`)
    if (query.sql.includes(';')) errors.push(`query "${query.id}" contains a semicolon`)
    if (query.parameters.length > 16) errors.push(`query "${query.id}" declares more than 16 parameters`)
    if (query.columns.length < 1 || query.columns.length > 64) errors.push(`query "${query.id}" must declare 1-64 columns`)
    const declared = new Set(query.parameters.map((parameter) => parameter.name))
    for (const match of query.sql.matchAll(/:([a-zA-Z_]\w*)/g)) if (!declared.has(match[1])) errors.push(`query "${query.id}" uses :${match[1]} without declaring it`)
  }
  return errors
}
