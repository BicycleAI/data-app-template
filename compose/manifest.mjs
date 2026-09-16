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
import { renderDatasets } from './datasets.mjs'

export function deriveManifest(spec) {
  return {
    appId: spec.appId ?? '',
    entry: 'app.js',
    styles: ['app.css'],
    title: spec.title,
    queries: renderDatasets(spec, datasetsFor(spec)),
  }
}

/**
 * The service's own contract, checked here so a failure is local and readable.
 * The service enforces these again on upload; this copy is a courtesy, not the
 * authority.
 */
export function checkManifest(manifest) {
  const errors = []
  if (manifest.queries.length > 32) errors.push(`${manifest.queries.length} queries; the limit is 32`)
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
