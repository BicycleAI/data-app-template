/**
 * Boot: resolve the host context, read the injected spec, mount.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { loadSpec } from './spec.js'
import { initContext } from './studio/context.js'
import { createQueryClient } from './studio/hooks.js'
import { pinTheme } from './studio/theme.js'
import './theme.css'

function applyThemeChoices() {
  const spec = loadSpec()
  document.documentElement.dataset.accent = spec.theme?.accent ?? 'blue'
  const follow = spec.theme?.follow ?? 'system'
  if (follow !== 'system') pinTheme(follow)
  return spec
}

function tree() {
  const spec = loadSpec()
  return (
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <App spec={spec} />
      </QueryClientProvider>
    </StrictMode>
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('the host page has no #root element')
const root = createRoot(container)

try {
  applyThemeChoices()
  await initContext()
  root.render(tree())
} catch (error) {
  root.render(<div className="bda-state bda-state--error">{(error as Error).message}</div>)
}

/** The server's validation harness calls this when present. */
export function mount(target: HTMLElement): () => void {
  applyThemeChoices()
  const mounted = createRoot(target)
  mounted.render(tree())
  return () => mounted.unmount()
}
