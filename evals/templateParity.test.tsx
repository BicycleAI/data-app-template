/** The template's copy of the host-brokered store client is the runtime's, byte for byte. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('template/src/studio/store.ts matches runtime/src/studio/store.ts', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
  expect(read('../template/src/studio/store.ts')).toBe(read('../runtime/src/studio/store.ts'))
})
