/**
 * The GCS resumable upload the service hands out: POST to start a session,
 * PUT the bytes to the session URI. Returns nothing; the caller then reports
 * sha256 + bytes through dataapp_complete_upload.
 */

import { readFileSync } from 'node:fs'

export async function uploadBundle(zipPath, uploadUrl) {
  const start = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'x-goog-resumable': 'start',
      'x-goog-meta-is-valid': 'false',
      'x-goog-meta-orig-file-name': 'bundle.zip',
      'content-type': 'application/zip',
    },
  })
  if (start.status !== 201) throw new Error(`upload session refused: HTTP ${start.status} ${await start.text()}`)
  const session = start.headers.get('location')
  if (session === null) throw new Error('upload session had no Location header')
  const put = await fetch(session, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: readFileSync(zipPath) })
  if (!put.ok) throw new Error(`upload failed: HTTP ${put.status} ${await put.text()}`)
}
